import { defineConfig } from 'drizzle-kit';

// Secrets come from the environment, never from code (AGENTS.md § Security &
// Authority). There is deliberately no hardcoded fallback URL — a missing
// DATABASE_URL must fail loudly rather than silently target a local database.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL environment variable is required');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url },
});
