# SafeRoute: Express API (news preprocessing, Gemini, scoring) + React front end.
# Runs on Cloud Run or any container host that sets $PORT.

# Stage 1: build the React front end
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The Maps key is not baked in; the server provides it at runtime via /api/config
RUN npm run build

# Stage 2: run the server, which serves the built front end and the API
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.ts tsconfig.json ./
COPY src ./src
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "server.ts"]
