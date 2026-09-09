import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Diagram } from '../../diagrams/entities/diagram.entity.js';

export enum PublicLinkMode {
  Read = 'public_read',
  Edit = 'public_edit',
}

@Entity('diagram_public_links')
export class PublicLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'diagram_id', type: 'uuid' })
  diagramId: string;

  @ManyToOne(() => Diagram, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'diagram_id' })
  diagram: Diagram;

  @Column({ type: 'enum', enum: PublicLinkMode, enumName: 'public_link_mode' })
  mode: PublicLinkMode;

  @Column({ name: 'token_nonce', type: 'varchar', length: 64 })
  tokenNonce: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
