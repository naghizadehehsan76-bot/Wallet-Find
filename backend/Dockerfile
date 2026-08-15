FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
EXPOSE 3000
CMD ["node", "dist/server.js"]
