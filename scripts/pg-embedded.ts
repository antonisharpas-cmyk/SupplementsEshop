/* ============================================================================
 * The embedded PostgreSQL for a small live server (Render, 512 MB), with its
 * files on a persistent disk.
 *
 * Kept small on purpose:
 *  · Postgres runs with small caches (16 MB shared buffers instead of 128 MB).
 *  · A brand new database is unpacked from an empty template made at build
 *    time (scripts/build-server.mjs), because creating one from scratch
 *    briefly needs more memory than the server has.
 *  · Unlike the development database, writes are flushed to disk (fsync on),
 *    so a crash cannot lose committed orders.
 * ========================================================================== */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

export const TEMPLATE = join(process.cwd(), '.pgdata-template.tar.gz')

/* PGlite's own defaults, without -F (fsync off), plus small memory settings. */
export const START_PARAMS = [
  '--single',
  '-O',
  '-j',
  '-c', 'search_path=public',
  '-c', 'exit_on_error=false',
  '-c', 'log_checkpoints=false',
  '-c', 'max_worker_processes=0',
  '-c', 'max_parallel_workers=0',
  '-c', 'max_parallel_workers_per_gather=0',
  '-c', 'max_parallel_maintenance_workers=0',
  '-c', 'io_method=sync',
  '-c', 'shared_buffers=16MB',
  '-c', 'work_mem=2MB',
  '-c', 'maintenance_work_mem=16MB',
  '-c', 'temp_buffers=2MB',
  '-c', 'wal_buffers=1MB',
]

export async function startEmbedded(dir: string, port: number) {
  mkdirSync(dir, { recursive: true })
  const fresh = readdirSync(dir).length === 0
  if (fresh && !existsSync(TEMPLATE)) {
    console.warn('  no database template found (.pgdata-template.tar.gz); creating one from scratch, which needs extra memory')
  }
  const db = await PGlite.create({
    dataDir: dir,
    extensions: { pg_trgm },
    startParams: START_PARAMS,
    ...(fresh && existsSync(TEMPLATE) ? { loadDataDir: new Blob([readFileSync(TEMPLATE)]) } : {}),
  })
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 20 })
  await server.start()
  return {
    async stop() {
      await server.stop()
      await db.close()
    },
  }
}

/** Build step: an empty, initialised data folder packed as the template. */
export async function makeTemplate() {
  const db = await PGlite.create({ extensions: { pg_trgm } })
  const blob = await db.dumpDataDir('gzip')
  await db.close()
  return Buffer.from(await blob.arrayBuffer())
}
