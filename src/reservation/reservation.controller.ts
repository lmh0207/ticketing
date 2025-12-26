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
}
