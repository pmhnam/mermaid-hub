# VPS Deployment

This repository includes a production Compose stack for the web editor, API,
and PostgreSQL. The web container joins the external Docker network `proxy`
so a Cloudflare Tunnel container can reach it without exposing the app publicly.

## First Deployment

Run these commands from the repository root:

```sh
cp .env.example .env
openssl rand -hex 32
```

Use three different generated values in `.env` for:

```dotenv
POSTGRES_PASSWORD=...
JWT_ACCESS_SECRET=...
PUBLIC_LINK_SECRET=...
```

Create the shared network once. If the Cloudflare Tunnel stack already created
it, this command is not needed:

```sh
docker network create proxy
```

Validate and start the stack:

```sh
docker compose config
docker compose up -d --build
```

Check the services and the database-backed API health endpoint:

```sh
docker compose ps
curl http://127.0.0.1:8088/api/health
```

The web app is available inside Docker as `http://mermaid-workspace-web:8080`.
The host binding is intentionally limited to `127.0.0.1:8088`.

## Cloudflare Tunnel

The `cloudflared` container must join the same external `proxy` network. Its
public hostname/service route should target:

```text
http://mermaid-workspace-web:8080
```

Do not use `localhost:8088` from inside the Cloudflare container. The nginx
container proxies `/api/*` and WebSocket traffic under `/ws/*` to the private
API service, so the public hostname remains same-origin for the frontend.

## Updates

```sh
git pull
docker compose up -d --build
```

PostgreSQL data is stored in the `postgres-data` Docker volume. API migrations
run automatically when the API starts. Back up this volume before destructive
database or VPS operations.

## Logs and Recovery

```sh
docker compose logs -f api web
docker compose restart api
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to delete
the PostgreSQL volume and all stored workspace data.
