import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Seat } from 'src/seat/seat.entity';
import {
  DataSource,
  OptimisticLockVersionMismatchError,
  Repository,
} from 'typeorm';
import { Reservation } from './reservation.entity';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class ReservationService {
  constructor(
    @InjectRepository(Reservation)
    private reservationRepository: Repository<Reservation>,
    @InjectRepository(Seat)
    private seatRepository: Repository<Seat>,
    private dataSource: DataSource, // 트랜잭션용 추가
    private redisService: RedisService,
  ) {}

  // 비관적 락
  async reserve(eventId: number, seatId: number, userId: string) {
    // 트랜잭션 시작
    return await this.dataSource.transaction(async (manager) => {
      // 1. 좌석 조회 + 락 획득(FOR UPDATE)
      const seat = await manager.findOne(Seat, {
        where: { id: seatId, event: { id: eventId } },
        lock: { mode: 'pessimistic_write' },
      });

      if (!seat) {
        throw new NotFoundException('좌석을 찾을 수 없습니다');
      }

      // 2. 이미 예약됐는지 확인
      if (seat.isReserved) {
        throw new BadRequestException('이미 예약된 좌석입니다');
      }

      // 딜레이 (테스트용)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 3. 예약 처리
      seat.isReserved = true;
      await manager.save(seat);

      const reservation = manager.create(Reservation, {
        userId,
        reservedAt: new Date(),
        seat,
      });
      await manager.save(reservation);

      return { message: '예약 완료', reservationId: reservation.id };
    });
  }

  // 낙관적 락
  async reserveOptimistic(eventId: number, seatId: number, userId: string) {
    // 트랜잭션 시작
    // 1. 좌석 조회
    const seat = await this.seatRepository.findOne({
      where: { id: seatId, event: { id: eventId } },
    });

    if (!seat) {
      throw new NotFoundException('좌석을 찾을 수 없습니다');
    }

    // 2. 이미 예약됐는지 확인
    if (seat.isReserved) {
      throw new BadRequestException('이미 예약된 좌석입니다');
    }

    // 딜레이 (테스트용)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 3. 예약 처리
    try {
      seat.isReserved = true;
      await this.seatRepository.save(seat);

      const reservation = this.reservationRepository.create({
        userId,
        reservedAt: new Date(),
        seat,
      });
      await this.reservationRepository.save(reservation);

      return { message: '예약 완료(낙관적 락)', reservationId: reservation.id };
    } catch (error) {
      // 낙관적 락 버전 충돌
      if (error instanceof OptimisticLockVersionMismatchError) {
        throw new ConflictException(
          '다른 사용자가 먼저 예약했습니다. 다시 시도해주세요.',
        );
      }
      // DB unique constraint 위반 (1:1 관계)
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('다른 사용자가 먼저 예약했습니다.');
      }

      throw error;
    }
  }

  // Redis 분산 락
  async reserveWithRedis(eventId: number, seatId: number, userId: string) {
    const lockKey = `lock:seat:${eventId}:${seatId}`;

    // 1. 락 획득 식도
    const acquired = await this.redisService.acquireLock(lockKey, 10);

    if (!acquired) {
      throw new ConflictException(
        '다른 사용자가 예약 중입니다. 잠시 후 다시 시도해주세요.',
      );
    }

    try {
      // 2. 좌석 조회
      const seat = await this.seatRepository.findOne({
        where: { id: seatId, event: { id: eventId } },
      });

      if (!seat) {
        throw new NotFoundException('좌석을 찾을 수 없습니다');
      }

      if (seat.isReserved) {
        throw new BadRequestException('이미 예약된 좌석입니다');
      }

      // 딜레이 (테스트용)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 3. 예약 처리
      seat.isReserved = true;
      await this.seatRepository.save(seat);

      const reservation = this.reservationRepository.create({
        userId,
        reservedAt: new Date(),
        seat,
      });
      await this.reservationRepository.save(reservation);

      return { message: '예약 완료 (Redis 락)', reservationId: reservation.id };
    } finally {
      // 4. 락 해제 (성공/실패 모두)
      await this.redisService.releaseLock(lockKey);
    }
  }
}
