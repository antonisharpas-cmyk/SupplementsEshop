/* Run after `next build` (npm run build). Prepares the live server so it
   starts in little memory:
     1. compiles the start and database scripts to plain JavaScript
        (dist-server/), so no TypeScript compiler runs on the server;
     2. makes the empty database template (.pgdata-template.tar.gz) the
        embedded database unpacks on its first start. */

import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const entries = ['start', 'prepare-db', 'db-push', 'seed', 'staff']

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
const { makeTemplate, TEMPLATE } = await import('../dist-server/pg-embedded.mjs')
writeFileSync(TEMPLATE, await makeTemplate())
console.log('✓ empty database template made')
