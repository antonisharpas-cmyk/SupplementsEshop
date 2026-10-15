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
config({ path: ['.env.local', '.env.development', '.env'], quiet: true })
