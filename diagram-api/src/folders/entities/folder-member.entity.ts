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
import { Folder } from './folder.entity.js';

@Entity('folder_members')
@Unique('uq_folder_members_folder_user', ['folderId', 'userId'])
export class FolderMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'folder_id', type: 'uuid' })
  folderId: string;

  @ManyToOne(() => Folder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'folder_id' })
  folder: Folder;

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
