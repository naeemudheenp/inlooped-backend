#!/bin/bash
set -e

# Change directory to where the script is located, then go up to backend root
cd "$(dirname "$0")/.."

echo "🚀 Bootstrapping Production Database (Neon)..."

# Load variables from .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Override Prisma's DATABASE_URL with the production one if provided
if [ -n "$DATABASE_URL_PROD" ]; then
  export DATABASE_URL=$DATABASE_URL_PROD
  export DIRECT_DATABASE_URL=$DATABASE_URL_PROD
  echo "✅ Using DATABASE_URL_PROD for Prisma."
else
  echo "⚠️ DATABASE_URL_PROD not found in environment or .env file."
  echo "Using default DATABASE_URL instead."
fi

if [ -z "$DATABASE_URL" ]; then
  echo "❌ Error: No database URL provided."
  exit 1
fi

echo "1/3 Generating Prisma Client..."
npx prisma generate

echo "2/3 Applying Production Migrations..."
npx prisma migrate deploy

echo "3/3 Seeding Database..."
npx ts-node prisma/seed.ts

echo "🎉 Production Database successfully bootstrapped!"
