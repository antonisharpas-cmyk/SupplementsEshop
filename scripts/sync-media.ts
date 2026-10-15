/* ============================================================================
 * Point the database at whatever pictures are in /public.
 *
 *     npm run media:sync        (npm run dev does this for you on a local DB)
 *
 * The seed decides photo-versus-drawing when it runs, and a seed wipes the
 * data — so dropping a new photograph into public/products used to mean
 * either re-seeding (losing accounts, bags and stock counts) or editing rows
 * by hand. This only rewrites the image links it manages. The logic lives in
 * src/lib/media-sync.ts.
 * ========================================================================== */

import './load-env'

import { db, pool } from '../src/db'
import { syncMedia } from '../src/lib/media-sync'

syncMedia(db)
  .then((changed) =>
    console.log(changed ? `✓ media — ${changed} picture link(s) updated` : '✓ media — up to date'),
  )
  .catch((err) => {
    console.error('✗ media sync failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
