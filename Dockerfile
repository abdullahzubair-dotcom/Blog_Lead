# GenAI Scout — self-hosted image (Next.js 16). Runs `next start` on a persistent Node process.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time envs aren't required (the app reads config at runtime), but Next needs to build.
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Bring the built app + deps. (No standalone output configured, so ship node_modules.)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
# Provide env at run time: docker run --env-file .env.local -p 3000:3000 genai-scout
CMD ["npm", "start"]
