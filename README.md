# ResolveAI

ResolveAI is a multi-tenant AI customer-support platform with authentication, workspace authorization, knowledge/RAG, agents, inbox handoff, billing, analytics, and an embeddable widget.

## Local setup

Requirements: Node.js 22.x, the pnpm version pinned in `package.json`, and Docker. Node 25 is not a supported project runtime. This is a pnpm workspace; do not run `npm install` or replace `pnpm-lock.yaml` with an npm lockfile.

With nvm, install the pinned runtime and package manager, then start the stack:

```sh
nvm install 22
nvm use 22
corepack enable
corepack prepare pnpm@9.15.0 --activate
cp .env.example .env
docker compose up -d
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm dev
```

If your Node distribution does not provide Corepack, install the pinned package manager explicitly with `npm install --global pnpm@9.15.0`, then run the same `pnpm install --frozen-lockfile` command.

The API is available at `http://localhost:4000/api/v1`; Swagger is at `/docs`; health is at `/api/v1/health`. The web app is at `http://localhost:3000`.

Production preparation, environment validation, Docker images, readiness checks, migrations, backups, and the deployment checklist are documented in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Structure

`apps/web` is the Next.js App Router dashboard, `apps/api` is the REST API, `apps/worker` is the BullMQ document-processing worker, and `apps/widget` contains the embeddable widget source. Shared contracts live in `packages/shared`; Prisma lives in `packages/database`; configuration, storage, UI, and AI seams are isolated in their own packages.

## Security and tenancy

Access tokens are short-lived JWTs. Refresh tokens are rotated and stored only as SHA-256 hashes. All organization/workspace reads and writes require authenticated membership and role checks. See `AGENTS.md` for contribution rules.

## CI

GitHub Actions runs install, lint, formatting, type checking, tests, and builds on pushes to `main` and pull requests.

