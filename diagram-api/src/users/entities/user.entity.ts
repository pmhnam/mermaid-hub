import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_users_email_active', { unique: true, where: 'deleted_at IS NULL' })
  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ name: 'display_name', type: 'varchar', length: 100 })
  displayName: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    select: false,
    nullable: true,
  })
  passwordHash: string | null;

  @Index('uq_users_google_subject', { unique: true })
  @Column({
    name: 'google_subject',
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
  })
  googleSubject: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
