import { config } from 'dotenv'
config({ path: ['.env.local', '.env'], quiet: true })
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  /* Migrations are plain SQL in ./drizzle — reviewable in a pull request,
     which matters when a migration touches money or stock. */
  verbose: true,
  strict: true,
})
