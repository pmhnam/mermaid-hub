import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DiagramComments1790208000000 implements MigrationInterface {
  name = 'DiagramComments1790208000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE diagram_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
      target varchar(200), resolved boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      'CREATE INDEX idx_diagram_comments_created ON diagram_comments(diagram_id, created_at)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE diagram_comments');
  }
}
