import { Event } from 'src/event/event.entity';
import { Reservation } from 'src/reservation/reservation.entity';
import {
  Column,
  Entity,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity()
export class Seat {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  seatNumber: number;

  @Column({ default: false })
  isReserved: boolean;

  @ManyToOne(() => Event, (event) => event.seats)
  event: Event;

  @OneToOne(() => Reservation, (reservation) => reservation.seat)
  reservation: Reservation;
}
