import { Body, Controller, Param, Post } from '@nestjs/common';
import { ReservationService } from './reservation.service';

@Controller()
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  @Post('events/:eventId/seats/:seatId/reserve')
  reserve(
    @Param('eventId') eventId: number,
    @Param('seatId') seatId: number,
    @Body('userId') userId: string,
  ) {
    return this.reservationService.reserve(eventId, seatId, userId);
  }

  // 낙관적 락 (새로 추가)
  @Post('events/:eventId/seats/:seatId/reserve-optimistic')
  reserveOptimistic(
    @Param('eventId') eventId: number,
    @Param('seatId') seatId: number,
    @Body('userId') userId: string,
  ) {
    return this.reservationService.reserveOptimistic(eventId, seatId, userId);
  }

  // Redis 분산 락
  @Post('events/:eventId/seats/:seatId/reserve-redis')
  reserveWithRedis(
    @Param('eventId') eventId: number,
    @Param('seatId') seatId: number,
    @Body('userId') userId: string,
  ) {
    return this.reservationService.reserveWithRedis(eventId, seatId, userId);
  }
}
