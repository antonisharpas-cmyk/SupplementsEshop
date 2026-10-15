/* ============================================================================
 * Video sources for the hero.
 *
 * The database stores one URL per screen size — the MP4, because H.264 plays
 * in every browser there is. When a WebM with the same name sits next to it
 * in /public, it is offered FIRST: VP9 is about a third smaller, and a browser
 * that cannot play it simply moves on to the MP4.
 *
 * The file is checked for rather than assumed, so a shop owner who uploads
 * only an MP4 never sends browsers to a 404 before the video starts.
 * ========================================================================== */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type VideoSource = { src: string; type: string }

export function videoSources(url: string | null | undefined): VideoSource[] {
  if (!url) return []
  const sources: VideoSource[] = []

  if (url.startsWith('/') && url.endsWith('.mp4')) {
    const webm = url.replace(/\.mp4$/, '.webm')
    if (existsSync(join(process.cwd(), 'public', webm))) {
      sources.push({ src: webm, type: 'video/webm; codecs="vp9"' })
    }
  }
  sources.push({
    src: url,
    type: url.endsWith('.webm') ? 'video/webm' : 'video/mp4',
  })
  return sources
}
