import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Diagram } from '../../diagrams/entities/diagram.entity.js';
import { PublicLink } from '../../public-links/entities/public-link.entity.js';
import { User } from '../../users/entities/user.entity.js';
import type { DiagramVisualLayout } from '../version-state.provider.js';

export enum VersionType {
  Manual = 'manual',
  Checkpoint = 'checkpoint',
  Restore = 'restore',
}

@Entity('diagram_versions')
@Unique('uq_diagram_versions_diagram_version', ['diagramId', 'versionNumber'])
@Check('chk_diagram_versions_version_positive', 'version_number > 0')
@Check(
  'chk_diagram_versions_attribution',
  'created_by IS NOT NULL OR created_via_public_link_id IS NOT NULL',
)
export class DiagramVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'diagram_id', type: 'uuid' })
  diagramId: string;

  @ManyToOne(() => Diagram, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'diagram_id' })
  diagram: Diagram;

  @Column({ name: 'version_number', type: 'integer' })
  versionNumber: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text' })
  config: string;

  @Column({ name: 'visual_layout', type: 'jsonb', nullable: true })
  visualLayout: DiagramVisualLayout | null;

  @Column({ type: 'enum', enum: VersionType, enumName: 'version_type' })
  type: VersionType;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @Column({ name: 'created_via_public_link_id', type: 'uuid', nullable: true })
  createdViaPublicLinkId: string | null;

  @ManyToOne(() => PublicLink, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_via_public_link_id' })
  createdViaPublicLink: PublicLink | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
