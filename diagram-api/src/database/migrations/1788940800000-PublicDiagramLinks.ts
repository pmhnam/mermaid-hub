import { MigrationInterface, QueryRunner } from 'typeorm';

export class PublicDiagramLinks1788940800000 implements MigrationInterface {
  name = 'PublicDiagramLinks1788940800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TYPE public_link_mode AS ENUM ('public_read', 'public_edit')",
    );
    await queryRunner.query(
      `CREATE TABLE diagram_public_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE, mode public_link_mode NOT NULL, token_nonce varchar(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz)`,
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX uq_diagram_public_links_active ON diagram_public_links (diagram_id) WHERE revoked_at IS NULL',
    );
    await queryRunner.query(
      'ALTER TABLE diagram_versions ALTER COLUMN created_by DROP NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE diagram_versions ADD COLUMN created_via_public_link_id uuid REFERENCES diagram_public_links(id) ON DELETE SET NULL',
    );
    await queryRunner.query(
      'ALTER TABLE diagram_versions ADD CONSTRAINT chk_diagram_versions_attribution CHECK (created_by IS NOT NULL OR created_via_public_link_id IS NOT NULL)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE diagram_versions DROP CONSTRAINT chk_diagram_versions_attribution',
    );
    await queryRunner.query(
      'ALTER TABLE diagram_versions DROP COLUMN created_via_public_link_id',
    );
    await queryRunner.query(
      'ALTER TABLE diagram_versions ALTER COLUMN created_by SET NOT NULL',
    );
    await queryRunner.query('DROP TABLE diagram_public_links');
    await queryRunner.query('DROP TYPE public_link_mode');
  }
}
