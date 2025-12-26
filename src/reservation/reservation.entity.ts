import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Seat } from '../seat/seat.entity';

@Entity()
export class Reservation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: string;

  @Column()
  reservedAt: Date;

  @OneToOne(() => Seat, (seat) => seat.reservation)
  @JoinColumn() // FK는 Reservation 쪽에
  seat: Seat;
}
