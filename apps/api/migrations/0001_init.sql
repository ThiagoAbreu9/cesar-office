-- Esquema do MVP (docs/02-arquitetura.md §6.3) + sessões, convites e asset do mapa.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

-- ───────────── Identidade (sem RLS: consultas por usuário atravessam orgs) ─────────────

CREATE TABLE organizations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  allowed_email_domain citext,
  chat_retention_days  int  NOT NULL DEFAULT 90 CHECK (chat_retention_days BETWEEN 1 AND 3650),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext NOT NULL UNIQUE,
  google_sub   text UNIQUE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  avatar       jsonb NOT NULL DEFAULT '{"body":0,"hair":0,"outfit":0}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE memberships (
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      member_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE invites (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        member_role NOT NULL DEFAULT 'member' CHECK (role <> 'owner'),
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  PRIMARY KEY (org_id, email)
);
CREATE INDEX invites_pending_email_idx ON invites (email) WHERE accepted_at IS NULL;

-- Refresh tokens rotativos: guardamos só o hash; família permite detectar reuso (roubo).
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  replaced_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE consents (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    text NOT NULL CHECK (kind IN ('microphone','terms','privacy')),
  granted boolean NOT NULL,
  version text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 20),
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_idx ON consents (user_id, at DESC);

-- ───────────── Dados de tenant (com RLS por org_id) ─────────────

CREATE TABLE spaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spaces_org_idx ON spaces (org_id);

CREATE TABLE maps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id   uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name       text NOT NULL,
  -- Chave do JSON Tiled servido ao realtime/cliente (MVP: arquivo `<asset_key>.json`).
  asset_key  text NOT NULL CHECK (asset_key ~ '^[a-zA-Z0-9_-]{1,64}$'),
  version    int  NOT NULL DEFAULT 1,
  is_default boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX maps_one_default_per_space ON maps (space_id) WHERE is_default;
CREATE INDEX maps_org_idx ON maps (org_id);

CREATE TABLE desk_assignments (
  org_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  map_id   uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  desk_key text NOT NULL,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (map_id, desk_key),
  UNIQUE (map_id, user_id)
);

CREATE TABLE user_space_state (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id   uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  map_id     uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  x          int  NOT NULL CHECK (x BETWEEN 0 AND 65535),
  y          int  NOT NULL CHECK (y BETWEEN 0 AND 65535),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, space_id)
);

CREATE TABLE chat_messages (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  channel       text NOT NULL,
  sender_id     uuid NOT NULL,
  body          text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  client_msg_id uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
-- Partição padrão evita falha de INSERT; job mensal cria partições nomeadas e a retenção vira DROP PARTITION.
CREATE TABLE chat_messages_default PARTITION OF chat_messages DEFAULT;
CREATE INDEX chat_channel_time_idx ON chat_messages (org_id, channel, created_at DESC);

CREATE TABLE audit_log (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id   uuid NOT NULL,
  actor_id uuid,
  action   text NOT NULL,
  data     jsonb NOT NULL DEFAULT '{}',
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_time_idx ON audit_log (org_id, at DESC);

-- RLS: a aplicação abre transação e faz set_config('app.org_id', <uuid>, true).
-- Fora dela a variável vale NULL (nunca definida) ou '' (definida antes e revertida no fim da transação,
-- caso comum com pool de conexões). NULLIF cobre os dois → nenhuma linha (falha FECHADO, sem erro).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['spaces','maps','desk_assignments','user_space_state','chat_messages','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid) WITH CHECK (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid)',
      t);
  END LOOP;
END
$$;

-- Permissões mínimas do papel da aplicação.
GRANT USAGE ON SCHEMA public TO cesar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organizations, users, memberships, invites, refresh_tokens, consents,
  spaces, maps, desk_assignments, user_space_state, chat_messages, chat_messages_default
TO cesar_app;
GRANT SELECT, INSERT ON audit_log TO cesar_app; -- auditoria é append-only
