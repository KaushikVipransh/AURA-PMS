import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved the connection URL out of schema.prisma. The CLI reads it
 * here; the runtime client gets it through a driver adapter (see src/index.ts).
 *
 * DATABASE_URL comes from the repository-root .env, which is why dotenv is
 * loaded with an explicit path — the CLI runs with packages/db as its cwd.
 */
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
