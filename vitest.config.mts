import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: ['.env.test.local', '.env.local', '.env'], quiet: true })

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    /* These tests share one database and truncate between cases, so they must
       not run in parallel with each other. */
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['src/**/*.test.ts'],
  },
})
