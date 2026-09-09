import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { ResourceRole } from '../../permissions/permission.types.js';
import { Diagram } from './diagram.entity.js';

@Entity('diagram_members')
@Unique('uq_diagram_members_diagram_user', ['diagramId', 'userId'])
export class DiagramMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'diagram_id', type: 'uuid' })
  diagramId: string;

  @ManyToOne(() => Diagram, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'diagram_id' })
  diagram: Diagram;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: ResourceRole, enumName: 'resource_role' })
  role: ResourceRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
