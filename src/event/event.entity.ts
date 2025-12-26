import { Seat } from 'src/seat/seat.entity';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Event {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  date: Date;

  @Column()
  totalSeats: number;

  @OneToMany(() => Seat, (seat) => seat.event)
  seats: Seat[];
}
