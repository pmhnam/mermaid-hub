import type { MigrationInterface, QueryRunner } from 'typeorm';

export class GoogleSignIn1790121600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE users ADD COLUMN google_subject varchar(255)',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX uq_users_google_subject ON users (google_subject)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Refuse rollback while Google-only accounts exist rather than deleting accounts
    // or inventing password credentials for them.
    await queryRunner.query(
      'ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL',
    );
    await queryRunner.query('DROP INDEX uq_users_google_subject');
    await queryRunner.query('ALTER TABLE users DROP COLUMN google_subject');
  }
}
