FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/build/ build/

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV TRANSPORT=http
# Listen on all interfaces inside the container; loopback is unreachable
# through a published port.
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "build/index.js"]
