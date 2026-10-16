/* How long an SMS is, in characters and in billed messages. Shared by the
   server and the admin composer. */

/* The GSM 7 bit alphabet. A message using only these characters fits 160
   characters in one SMS; anything else (Greek lower case, Cyrillic, emoji)
   switches the whole message to Unicode, 70 characters per SMS. */
const GSM =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXT = '^{}\\[~]|€'
const gsmSet = new Set([...GSM])
const extSet = new Set([...GSM_EXT])

export type SmsLength = { encoding: 'GSM' | 'Unicode'; characters: number; segments: number; perSegment: number }

export function smsLength(text: string): SmsLength {
  const chars = [...text]
  const gsm = chars.every((c) => gsmSet.has(c) || extSet.has(c))
  if (gsm) {
    const n = chars.reduce((k, c) => k + (extSet.has(c) ? 2 : 1), 0)
    const segments = n <= 160 ? 1 : Math.ceil(n / 153)
    return { encoding: 'GSM', characters: n, segments, perSegment: n <= 160 ? 160 : 153 }
  }
  const n = chars.reduce((k, c) => k + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0)
  const segments = n <= 70 ? 1 : Math.ceil(n / 67)
  return { encoding: 'Unicode', characters: n, segments, perSegment: n <= 70 ? 70 : 67 }
}

