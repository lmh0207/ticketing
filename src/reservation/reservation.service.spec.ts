import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReservationService } from './reservation.service';
import { Reservation } from './reservation.entity';
import { Seat } from '../seat/seat.entity';
import { Event } from '../event/event.entity';
import { RedisService } from '../redis/redis.service';
import { ConflictException, BadRequestException } from '@nestjs/common';

interface ReservationResult {
  message: string;
  reservationId: number;
}

describe('ReservationService 동시성 테스트', () => {
  let service: ReservationService;
  let dataSource: DataSource;
  let redisService: RedisService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: 'localhost',
          port: 5432,
          username: 'ticketing',
          password: 'ticketing123',
          database: 'ticketing',
          entities: [Event, Seat, Reservation],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([Event, Seat, Reservation]),
      ],
      providers: [ReservationService, RedisService],
    }).compile();

    service = module.get<ReservationService>(ReservationService);
    dataSource = module.get<DataSource>(DataSource);
    redisService = module.get<RedisService>(RedisService);
  }, 30000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    await redisService?.onModuleDestroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE reservation, seat, event RESTART IDENTITY CASCADE',
    );
    await dataSource.query(`
      INSERT INTO event (name, date, "totalSeats") VALUES ('테스트 콘서트', '2025-03-01', 100)
    `);
    await dataSource.query(`
      INSERT INTO seat ("seatNumber", "isReserved", "eventId", version) VALUES (1, false, 1, 1)
    `);
  });

  describe('비관적 락 (Pessimistic Lock)', () => {
    it('동시에 100개 요청 시 1개만 성공해야 함', async () => {
      const concurrentRequests = 100;
      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        service.reserve(1, 1, `user${i}`).catch((e: Error) => e),
      );

      const results = await Promise.all(promises);

      const successes = results.filter(
        (r): r is ReservationResult =>
          typeof r === 'object' && r !== null && 'reservationId' in r,
      );
      const failures = results.filter((r) => r instanceof Error);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(concurrentRequests - 1);

      const reservations = await dataSource.query<{ count: string }[]>(
        'SELECT COUNT(*) FROM reservation',
      );
      expect(parseInt(reservations[0].count)).toBe(1);
    });

    it('이미 예약된 좌석에 요청 시 BadRequestException 발생', async () => {
      await service.reserve(1, 1, 'user1');
      await expect(service.reserve(1, 1, 'user2')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('낙관적 락 (Optimistic Lock)', () => {
    it('동시에 100개 요청 시 1개만 성공해야 함', async () => {
      const concurrentRequests = 100;
      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        service.reserveOptimistic(1, 1, `user${i}`).catch((e: Error) => e),
      );

      const results = await Promise.all(promises);

      const successes = results.filter(
        (r): r is ReservationResult =>
          typeof r === 'object' && r !== null && 'reservationId' in r,
      );
      const failures = results.filter(
        (r) =>
          r instanceof ConflictException || r instanceof BadRequestException,
      );

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(concurrentRequests - 1);

      const reservations = await dataSource.query<{ count: string }[]>(
        'SELECT COUNT(*) FROM reservation',
      );
      expect(parseInt(reservations[0].count)).toBe(1);
    });
  });

  describe('Redis 분산 락 (Distributed Lock)', () => {
    beforeEach(async () => {
      await redisService.releaseLock('lock:seat:1:1');
    });

    it('동시에 100개 요청 시 1개만 성공해야 함', async () => {
      const concurrentRequests = 100;
      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        service.reserveWithRedis(1, 1, `user${i}`).catch((e: Error) => e),
      );

      const results = await Promise.all(promises);

      const successes = results.filter(
        (r): r is ReservationResult =>
          typeof r === 'object' && r !== null && 'reservationId' in r,
      );
      const failures = results.filter((r) => r instanceof ConflictException);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(concurrentRequests - 1);

      const reservations = await dataSource.query<{ count: string }[]>(
        'SELECT COUNT(*) FROM reservation',
      );
      expect(parseInt(reservations[0].count)).toBe(1);
    });

    it('락 획득 실패 시 ConflictException 발생', async () => {
      await redisService.acquireLock('lock:seat:1:1', 10);
      await expect(service.reserveWithRedis(1, 1, 'user1')).rejects.toThrow(
        ConflictException,
      );
      await redisService.releaseLock('lock:seat:1:1');
    });
  });

  describe('성능 비교', () => {
    it('각 락 방식별 처리 시간 측정', async () => {
      const concurrentRequests = 100;

      // 비관적 락 테스트
      const pessimisticStart = Date.now();
      await Promise.all(
        Array.from({ length: concurrentRequests }, (_, i) =>
          service.reserve(1, 1, `user${i}`).catch(() => undefined),
        ),
      );
      const pessimisticTime = Date.now() - pessimisticStart;

      // 데이터 리셋
      await dataSource.query(
        'TRUNCATE reservation, seat RESTART IDENTITY CASCADE',
      );
      await dataSource.query(`
        INSERT INTO seat ("seatNumber", "isReserved", "eventId", version) VALUES (1, false, 1, 1)
      `);

      // 낙관적 락 테스트
      const optimisticStart = Date.now();
      await Promise.all(
        Array.from({ length: concurrentRequests }, (_, i) =>
          service.reserveOptimistic(1, 1, `user${i}`).catch(() => undefined),
        ),
      );
      const optimisticTime = Date.now() - optimisticStart;

      // 데이터 리셋
      await dataSource.query(
        'TRUNCATE reservation, seat RESTART IDENTITY CASCADE',
      );
      await dataSource.query(`
        INSERT INTO seat ("seatNumber", "isReserved", "eventId", version) VALUES (1, false, 1, 1)
      `);
      await redisService.releaseLock('lock:seat:1:1');

      // Redis 락 테스트
      const redisStart = Date.now();
      await Promise.all(
        Array.from({ length: concurrentRequests }, (_, i) =>
          service.reserveWithRedis(1, 1, `user${i}`).catch(() => undefined),
        ),
      );
      const redisTime = Date.now() - redisStart;

      console.log('\n=== 성능 비교 (100개 동시 요청) ===');
      console.log(`비관적 락: ${pessimisticTime}ms`);
      console.log(`낙관적 락: ${optimisticTime}ms`);
      console.log(`Redis 락: ${redisTime}ms`);

      // 성능 측정 결과 확인 (환경에 따라 다를 수 있음)
      expect(pessimisticTime).toBeGreaterThan(0);
      expect(optimisticTime).toBeGreaterThan(0);
      expect(redisTime).toBeGreaterThan(0);
    });
  });
});
