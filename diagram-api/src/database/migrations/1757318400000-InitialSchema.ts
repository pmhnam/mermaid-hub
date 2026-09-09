import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1757318400000 implements MigrationInterface {
  name = 'InitialSchema1757318400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS ltree');
    await queryRunner.query(
      "CREATE TYPE workspace_kind AS ENUM ('personal', 'team')",
    );
    await queryRunner.query(
      "CREATE TYPE workspace_role AS ENUM ('member', 'owner')",
    );
    await queryRunner.query(
      "CREATE TYPE resource_role AS ENUM ('viewer', 'editor', 'owner')",
    );
    await queryRunner.query(
      "CREATE TYPE version_type AS ENUM ('manual', 'checkpoint', 'restore')",
    );
    await queryRunner.query(
      `CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(320) NOT NULL, display_name varchar(100) NOT NULL, password_hash varchar(255) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)`,
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX uq_users_email_active ON users (lower(email)) WHERE deleted_at IS NULL',
    );
    await queryRunner.query(
      `CREATE TABLE auth_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, refresh_token_hash varchar(255) NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, replaced_by_session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL, user_agent varchar(512), ip_address inet, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz)`,
    );
    await queryRunner.query(
      'CREATE INDEX idx_auth_sessions_user_active ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL',
    );
    await queryRunner.query(
      `CREATE TABLE workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(120) NOT NULL, kind workspace_kind NOT NULL DEFAULT 'team', owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)`,
    );
    await queryRunner.query(
      'CREATE INDEX idx_workspaces_owner ON workspaces (owner_id)',
    );
    await queryRunner.query(
      `CREATE TABLE workspace_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role workspace_role NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_workspace_members_workspace_user UNIQUE (workspace_id, user_id))`,
    );
    await queryRunner.query(
      'CREATE INDEX idx_workspace_members_user ON workspace_members (user_id)',
    );
    await queryRunner.query(
      `CREATE TABLE folders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, parent_id uuid REFERENCES folders(id) ON DELETE CASCADE, name varchar(120) NOT NULL, path ltree NOT NULL, depth smallint NOT NULL, created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)`,
    );
    await queryRunner.query(
      'CREATE INDEX idx_folders_workspace_parent ON folders (workspace_id, parent_id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_folders_path_gist ON folders USING gist (path)',
    );
    await queryRunner.query(
      "CREATE UNIQUE INDEX uq_folders_active_sibling_name ON folders (workspace_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE deleted_at IS NULL",
    );
    await queryRunner.query(
      `CREATE TABLE folder_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), folder_id uuid NOT NULL REFERENCES folders(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role resource_role NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_folder_members_folder_user UNIQUE (folder_id, user_id))`,
    );
    await queryRunner.query(
      `CREATE TABLE diagrams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, folder_id uuid REFERENCES folders(id) ON DELETE SET NULL, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, title varchar(160) NOT NULL, current_content text NOT NULL DEFAULT '', current_config text NOT NULL DEFAULT '', yjs_state bytea, version_seq integer NOT NULL DEFAULT 0, current_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, CONSTRAINT chk_diagrams_version_seq_nonnegative CHECK (version_seq >= 0))`,
    );
    await queryRunner.query(
      'CREATE INDEX idx_diagrams_workspace_folder ON diagrams (workspace_id, folder_id)',
    );
    await queryRunner.query(
      "CREATE UNIQUE INDEX uq_diagrams_active_folder_title ON diagrams (workspace_id, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(title)) WHERE deleted_at IS NULL",
    );
    await queryRunner.query(
      `CREATE TABLE diagram_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role resource_role NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_diagram_members_diagram_user UNIQUE (diagram_id, user_id))`,
    );
    await queryRunner.query(
      `CREATE TABLE diagram_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE, version_number integer NOT NULL, content text NOT NULL, config text NOT NULL, type version_type NOT NULL, message text, created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_diagram_versions_diagram_version UNIQUE (diagram_id, version_number), CONSTRAINT chk_diagram_versions_version_positive CHECK (version_number > 0))`,
    );
    await queryRunner.query(
      'ALTER TABLE diagrams ADD CONSTRAINT fk_diagrams_current_version FOREIGN KEY (current_version_id) REFERENCES diagram_versions(id) ON DELETE SET NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE diagrams DROP CONSTRAINT fk_diagrams_current_version',
    );
    for (const table of [
      'diagram_versions',
      'diagram_members',
      'diagrams',
      'folder_members',
      'folders',
      'workspace_members',
      'workspaces',
      'auth_sessions',
      'users',
    ]) {
      await queryRunner.query(`DROP TABLE ${table}`);
    }
    await queryRunner.query('DROP TYPE version_type');
    await queryRunner.query('DROP TYPE resource_role');
    await queryRunner.query('DROP TYPE workspace_role');
    await queryRunner.query('DROP TYPE workspace_kind');
  }
}
