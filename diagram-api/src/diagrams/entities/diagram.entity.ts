import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Folder } from '../../folders/entities/folder.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { Workspace } from '../../workspaces/entities/workspace.entity.js';
import type { DiagramVersion } from '../../versions/entities/version.entity.js';

@Entity('diagrams')
@Index('idx_diagrams_workspace_folder', ['workspaceId', 'folderId'])
@Check('chk_diagrams_version_seq_nonnegative', 'version_seq >= 0')
export class Diagram {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'folder_id', type: 'uuid', nullable: true })
  folderId: string | null;

  @ManyToOne(() => Folder, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'folder_id' })
  folder: Folder | null;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column({ name: 'current_content', type: 'text', default: '' })
  currentContent: string;

  @Column({ name: 'current_config', type: 'text', default: '' })
  currentConfig: string;

  @Column({ name: 'yjs_state', type: 'bytea', nullable: true })
  yjsState: Buffer | null;

  @Column({ name: 'version_seq', type: 'integer', default: 0 })
  versionSeq: number;

  @Column({ name: 'current_version_id', type: 'uuid', nullable: true })
  currentVersionId: string | null;

  @ManyToOne('DiagramVersion', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'current_version_id' })
  currentVersion: DiagramVersion | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
