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

### GitHub Actions

Pushing to `main` runs `.github/workflows/deploy.yml`. The workflow connects to
the VPS, fast-forwards the repository, rebuilds the Compose services, and checks
the API health endpoint. It can also be started manually from the Actions tab.

Create a GitHub environment named `production`, then add these environment
secrets:

| Secret               | Value                                    |
| -------------------- | ---------------------------------------- |
| `DEPLOY_HOST`        | VPS hostname or IP address               |
| `DEPLOY_USER`        | SSH user, for example `ubuntu`           |
| `DEPLOY_PORT`        | SSH port; leave empty to use `22`        |
| `DEPLOY_PATH`        | Absolute repository path on the VPS      |
| `DEPLOY_SSH_KEY`     | Private key authorized for `DEPLOY_USER` |
| `DEPLOY_KNOWN_HOSTS` | Trusted SSH host-key line for the VPS    |

Generate the `DEPLOY_KNOWN_HOSTS` value from a trusted machine and verify its
fingerprint before saving it in GitHub:

```sh
ssh-keyscan -p 22 -H your-vps.example
```

The server must already contain a clone of this repository, its production
`.env`, the external `proxy` Docker network, Docker with the Compose plugin, and
Git credentials that can read the repository. The workflow deliberately uses
`git pull --ff-only`; it stops instead of overwriting local server changes.

### Google sign-in (optional)

Create an OAuth 2.0 **Web application** client in Google Cloud / Google Auth Platform.
Configure the consent screen and add test users while the application is in testing.
Add this exact authorized redirect URI, using your real public hostname:

```text
https://your-domain.example/api/auth/google/callback
```

Set these backend variables in the Compose `.env` file:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-domain.example/api/auth/google/callback
APP_URL=https://your-domain.example
```

Rebuild/restart the stack. The API runs the Google identity migration automatically;
the login and registration pages show **Continue with Google** when all settings are
present. No Google secret is sent to the frontend. The redirect flow uses state,
PKCE and a nonce, verifies the Google ID token, then issues the usual application
session cookie. Google access/refresh tokens are not stored.

First sign-in creates a personal workspace. Returning users are identified by
Google's stable subject ID. Existing password accounts are not automatically linked
by matching email: those users must keep signing in with their password. This avoids
silently granting access to an existing account. If consent is cancelled or validation
fails, the login page displays a retryable error.

To disable Google sign-in, leave all four variables empty. Email/password login
continues to work. Reverting the migration requires handling any Google-only accounts
first because they intentionally have no password hash.

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
