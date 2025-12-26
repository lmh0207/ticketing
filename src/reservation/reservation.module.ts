import { Module } from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { ReservationController } from './reservation.controller';
import { Reservation } from './reservation.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Seat } from 'src/seat/seat.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation, Seat])],
  controllers: [ReservationController],
  providers: [ReservationService],
})
export class ReservationModule {}
