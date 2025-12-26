import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Seat } from 'src/seat/seat.entity';
import { DataSource, Repository } from 'typeorm';
import { Reservation } from './reservation.entity';

@Injectable()
export class ReservationService {
  constructor(
    @InjectRepository(Reservation)
    private reservationRepository: Repository<Reservation>,
    @InjectRepository(Seat)
    private seatRepository: Repository<Seat>,
    private dataSource: DataSource, // 트랜잭션용 추가
  ) {}

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
}
