# Use Node.js 22.14.0
FROM node:22.14.0-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    curl \
    python3 \
    make \
    g++ \
    postgresql-client \
    redis \
    openssl \
    openssl-dev

# Verify Node.js version and install pnpm
RUN node --version && \
    npm install -g pnpm@8.15.4 && \
    pnpm --version

# Set up pnpm environment
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN mkdir -p ${PNPM_HOME}

WORKDIR /app

# Copy package files and configuration
COPY package.json .npmrc ./

# Development stage with all dependencies
FROM base AS deps
RUN pnpm install

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && \
    pnpm build

# Production stage
FROM base AS runner
WORKDIR /app

# Copy package files and configuration
COPY package.json .npmrc ./
RUN pnpm install --prod

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy necessary runtime files
COPY .env* ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 \
    && chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000
CMD ["node", "dist/server/index.js"]