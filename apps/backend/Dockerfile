# The backend image. Built from the repository root so the shared package is in the context:
#
#   docker build -f apps/backend/Dockerfile -t coopmanage-api .
#
# Two stages. The first installs everything and compiles; the second carries only what runs:
# production dependencies, the compiled JavaScript, the Prisma schema and migrations (for
# `prisma migrate deploy` before each release), and a PostgreSQL client for `db:backup`.
#
# PG_CLIENT_VERSION must match the production server's major version: a dump written by a newer
# client carries settings an older server refuses on restore, and an older client refuses to dump a
# newer server at all. Supabase projects run 15 or 17; check the project's settings.

ARG NODE_VERSION=22
ARG PG_CLIENT_VERSION=17

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /repo
# argon2 and pdfkit ship prebuilt binaries for musl; python and make are here for the day they do not.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspace @coopmanage/shared --workspace @coopmanage/backend
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN npm run build -w @coopmanage/shared && npm run build -w @coopmanage/backend
# Drop everything that is not needed to run.
RUN npm prune --omit=dev --workspace @coopmanage/shared --workspace @coopmanage/backend

FROM node:${NODE_VERSION}-alpine AS runtime
ARG PG_CLIENT_VERSION
ENV NODE_ENV=production
RUN apk add --no-cache postgresql${PG_CLIENT_VERSION}-client tini
WORKDIR /repo
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/backend/package.json apps/backend/
COPY --from=build /repo/apps/backend/prisma.config.ts apps/backend/
COPY --from=build /repo/apps/backend/prisma apps/backend/prisma
COPY --from=build /repo/apps/backend/dist apps/backend/dist
WORKDIR /repo/apps/backend
# Not root: the process needs nothing the node user cannot do.
USER node
EXPOSE 4000
# tini reaps and forwards signals, so SIGTERM from the platform reaches the server's shutdown.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/server.js"]
