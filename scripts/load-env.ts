/* Imported FIRST by every script. ESM evaluates imports in declaration order,
   so this guarantees process.env is populated before src/db is constructed —
   a dotenv call in the script body runs too late, because the db import is
   hoisted above it.

   The order below is Next.js's own precedence, so a script and the dev server
   never disagree about which database they are talking to: the first file that
   defines a variable wins. `.env.local` is yours and gitignored; the committed
   `.env.development` only supplies the local-development defaults that make a
   fresh clone run without hand-writing a dotfile. */
import { config } from 'dotenv'

/* On the live server with the database on the Render disk (EMBEDDED_DB_DIR),
   a script run from the Shell tab talks to the database inside the running
   service, exactly as `npm start` does (a DATABASE_URL left in Render's
   settings is ignored then, there too). Set before the files below, so the
   development address in .env.development can never be picked up there. */
if (process.env.EMBEDDED_DB_DIR) {
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${process.env.EMBEDDED_DB_PORT ?? 5433}/postgres`
  process.env.DATABASE_SSL = 'disable'
}

config({ path: ['.env.local', '.env.development', '.env'], quiet: true })
