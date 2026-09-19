import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Diagram } from './diagram.entity.js';
import { User } from '../../users/entities/user.entity.js';

@Entity('diagram_comments')
@Index('idx_diagram_comments_created', ['diagramId', 'createdAt'])
export class DiagramComment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'diagram_id', type: 'uuid' }) diagramId: string;
  @ManyToOne(() => Diagram, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'diagram_id' })
  diagram: Diagram;
  @Column({ name: 'author_id', type: 'uuid' }) authorId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: User;
  @Column({ type: 'text' }) body: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) target:
    string | null;
  @Column({ type: 'boolean', default: false }) resolved: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
