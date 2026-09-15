import { MigrationInterface, QueryRunner } from 'typeorm';

export class VisualLayout1790035200000 implements MigrationInterface {
  name = 'VisualLayout1790035200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE diagrams ADD COLUMN visual_layout jsonb',
    );
    await queryRunner.query(
      'ALTER TABLE diagram_versions ADD COLUMN visual_layout jsonb',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE diagram_versions DROP COLUMN visual_layout',
    );
    await queryRunner.query('ALTER TABLE diagrams DROP COLUMN visual_layout');
  }
}
