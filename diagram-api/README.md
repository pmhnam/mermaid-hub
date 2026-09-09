# Diagram API

NestJS and PostgreSQL API for Mermaid diagram storage, folder sharing, version history, authentication, and Yjs WebSocket collaboration.

## Requirements

- Node.js 24+
- pnpm
- PostgreSQL 17 with the `ltree` extension

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm migration:run
pnpm start:dev
```

The HTTP API listens on `http://localhost:3000/api` by default. OpenAPI documentation is available at `/api/openapi`.

Important environment settings:

- `DATABASE_URL`: PostgreSQL connection URL.
- `JWT_ACCESS_SECRET`: random secret of at least 32 characters.
- `DB_MIGRATIONS_RUN`: set to `true` to run migrations during application startup.
- `COOKIE_SECURE`: set to `true` when serving over HTTPS.
- `COLLABORATION_SAVE_DEBOUNCE_MS`: delay before live Yjs state is persisted; persistence does not create a version.
- `COLLABORATION_CHECKPOINT_INTERVAL_MS`: fixed interval after the first uncheckpointed live edit before an automatic version is created; defaults to 20 minutes (`1200000`).
- `COLLABORATION_IDLE_TIMEOUT_MS`: time an empty in-memory collaboration room remains cached.
- `COLLABORATION_MAX_MESSAGE_BYTES`: WebSocket message and payload limit.

See `.env.example` for the complete development configuration.

## Database

Schema changes use TypeORM migrations. Do not enable `synchronize`.

```bash
# apply pending migrations
pnpm migration:run

# revert the latest migration
pnpm migration:revert

# generate a migration (pass a path/name after --)
pnpm migration:generate -- src/database/migrations/DescribeChange
```

## API Contract

Clients authenticate with `Authorization: Bearer <access-token>`. Registration and login return the short-lived access token; the refresh token is an HTTP-only cookie. Resource access is inherited from workspace and folder grants. Direct diagram grants are supported only for diagrams at the workspace root.

Core routes include:

- `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`
- `/api/workspaces` and `/api/workspaces/:id/tree`
- `/api/folders/:id` and `/api/folders/:id/members`
- `/api/diagrams/:id`, `/api/diagrams/:id/members`, and `/api/diagrams/:id/versions`
- `/api/health`, which reports database readiness separately

Member list responses contain direct grants only and expose only `userId`, `email`, `displayName`, and `role`.

### Collaboration WebSocket

1. Create a short-lived, single-use ticket with `POST /api/diagrams/:id/collaboration-ticket` using the normal bearer token.
2. Connect a standard y-websocket protocol client to `ws(s)://<host>/ws/collaboration?diagramId=<uuid>&ticket=<ticket>`.

The `/api` prefix does not apply to the WebSocket path. Never put JWTs in the WebSocket URL. Viewers can synchronize and publish awareness but cannot mutate the Y.Doc.

## Tests And Checks

```bash
pnpm format
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm test:e2e:collaboration
pnpm test:cov
```

PostgreSQL e2e tests skip when `DATABASE_URL` is absent. To run them against the development database:

```bash
DATABASE_URL=postgresql://diagram:diagram@localhost:5432/diagram \
JWT_ACCESS_SECRET=replace-with-at-least-32-random-characters \
NODE_ENV=test \
pnpm test:e2e
```

## Deployment Constraints

Deploy the web application and API behind the same HTTPS origin. Route `/api/*` to this service and preserve WebSocket upgrades for `/ws/collaboration`; this keeps refresh cookies same-origin and avoids exposing tokens in cross-origin configuration.

The MVP is single-instance:

- collaboration tickets are process-local and single-use;
- active Y.Docs, awareness, save/checkpoint timers, and per-document locks are process-local;
- WebSocket clients connected to different instances will not share live state.

Horizontal scaling requires a shared atomic ticket store and a shared or affinity-routed collaboration backend. Until then, run one API instance; sticky sessions alone do not coordinate Yjs rooms across processes.

## Production Commands

```bash
pnpm build
pnpm start:prod
```
