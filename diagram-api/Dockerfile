FROM node:24.16.0-alpine3.22 AS builder

RUN apk add --no-cache build-base python3 && corepack enable pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY nest-cli.json tsconfig.build.json tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24.16.0-alpine3.22 AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
