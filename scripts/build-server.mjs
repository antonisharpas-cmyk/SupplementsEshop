/* Run after `next build` (npm run build). Prepares the live server so it
   starts in little memory:
     1. compiles the start and database scripts to plain JavaScript
        (dist-server/), so no TypeScript compiler runs on the server;
     2. makes the empty database template (.pgdata-template.tar.gz) the
        embedded database unpacks on its first start. */

import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entries = ['start', 'prepare-db', 'db-push', 'seed', 'staff', 'clear-test-data']

/* Next's subpath imports (next/headers …) need their .js file named when
   loaded as plain ES modules outside Next. */
const nextSubpaths = {
  name: 'next-subpaths',
  setup(b) {
    b.onResolve({ filter: /^next\/[a-z-]+$/ }, (args) => ({ path: `${args.path}.js`, external: true }))
  },
}
await build({
  entryPoints: entries.map((e) => `scripts/${e}.ts`),
  outdir: 'dist-server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  logLevel: 'warning',
  plugins: [nextSubpaths],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})
console.log(`✓ server scripts compiled: ${entries.join(', ')}`)

await build({
  entryPoints: ['scripts/pg-embedded.ts'],
  outfile: 'dist-server/pg-embedded.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  logLevel: 'warning',
})
const { startEmbedded, TEMPLATE } = await import('../dist-server/pg-embedded.mjs')

/* The template is a complete starting database: tables, the starting data
   and the admin accounts, prepared here where the build machine has memory
   to spare. The live server's first start then only unpacks it. */
const work = mkdtempSync(join(tmpdir(), 'aionix-template-'))
const port = 55432
const pg = await startEmbedded(join(work, 'data'), port)
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/postgres`,
  DATABASE_SSL: 'disable',
  DATABASE_POOL_MAX: '4',
}
const run = (file, args = [], extra = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`dist-server/${file}.mjs`, ...args], { stdio: 'inherit', env: { ...env, ...extra } })
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${file} failed (${code})`))))
  })
try {
  await run('db-push')
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || process.env.STAFF_SUPPORT_PASSWORD
  if (adminPassword) {
    /* NODE_ENV=production: no demo customer account in a real shop. */
    await run('seed', [], { SEED_ADMIN_PASSWORD: adminPassword, NODE_ENV: 'production' })
    await run('staff', ['--if-configured'])
  } else {
    console.log('  (no STAFF_SUPPORT_PASSWORD at build time: the template has tables only)')
  }
  const blob = await pg.db.dumpDataDir('gzip')
  writeFileSync(TEMPLATE, Buffer.from(await blob.arrayBuffer()))
} finally {
  await pg.stop()
  rmSync(work, { recursive: true, force: true })
}
console.log('✓ starting database template made')
