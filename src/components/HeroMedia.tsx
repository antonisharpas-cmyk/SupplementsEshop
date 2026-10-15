'use client'

/* ============================================================================
 * The hero's moving picture.
 *
 * What the visitor sees, in order:
 *
 *   1. The poster — the loop's own first frame — painted immediately by the
 *      server as an ordinary <img>. It is the page's largest element, so it is
 *      what the browser measures as "loaded" (LCP), and it must not wait on
 *      JavaScript or on a video decoder.
 *   2. Once the video is actually playing, it fades in over the poster across
 *      1.4 seconds. Because the poster IS frame one, the fade reveals motion
 *      rather than swapping one image for another — there is no pop.
 *
 * The loop is built to be seamless (IMAGES.md, "Hero video"): its last frame
 * leads into its first exactly as any two neighbouring frames do, so the
 * browser's `loop` never shows a join.
 *
 * Deliberately NOT played when:
 *   · the visitor has asked their system for reduced motion — they get the
 *     poster and a Play button, never an unrequested moving image;
 *   · the browser reports Save-Data — a 2 MB loop is not worth someone's
 *     mobile allowance;
 *   · the hero is scrolled out of view — it pauses, so a page that has moved
 *     on is not decoding video nobody is looking at.
 *
 * A pause control is always present. Moving content that runs for more than
 * five seconds must be stoppable (WCAG 2.2.2), and this runs indefinitely.
 * ========================================================================== */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { VideoSource } from '@/lib/media'

type Props = {
  /** Best first: WebM (smaller) when there is one, then MP4 (plays anywhere). */
  video: VideoSource[]
  mobileVideo?: VideoSource[]
  poster?: string | null
  mobilePoster?: string | null
  pauseLabel: string
  playLabel: string
}

/** Matches Tailwind's `md` breakpoint, so the video swaps where the layout does. */
const MOBILE = '(max-width: 767px)'

/** A media query as React state. `null` on the server, where there is no
 *  screen to ask — which is exactly when no <video> should be rendered. It
 *  also follows a phone being turned on its side. */
function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', notify)
      return () => m.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => null,
  )
}

export function HeroMedia({ video, mobileVideo, poster, mobilePoster, pauseLabel, playLabel }: Props) {
  const ref = useRef<HTMLVideoElement>(null)
  const isMobile = useMediaQuery(MOBILE)
  const sources =
    isMobile === null ? null : isMobile && mobileVideo?.length ? mobileVideo : video
  const src = sources?.[0]?.src ?? null
  const [visible, setVisible] = useState(false)
  const [playing, setPlaying] = useState(false)
  /* Distinguishes "the visitor pressed pause" — or asked for reduced motion,
     or is saving data, from "it paused because it scrolled away". Only the
     second kind resumes by itself. */
  const userPaused = useRef<boolean | null>(null)

  /* Play in view, pause out of view. */
  useEffect(() => {
    const el = ref.current
    if (!el || !src) return

    if (userPaused.current === null) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection?.saveData
      userPaused.current = Boolean(reduced || saveData)
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!userPaused.current) el.play().catch(() => {})
        } else {
          el.pause()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [src])

  function toggle() {
    const el = ref.current
    if (!el) return
    if (el.paused) {
      userPaused.current = false
      el.play().catch(() => {})
    } else {
      userPaused.current = true
      el.pause()
    }
  }

  return (
    <>
      {/* 1. The poster: server-rendered, painted first, never removed. */}
      {poster && (
        <picture>
          {mobilePoster && <source media={MOBILE} srcSet={mobilePoster} />}
          <img
            src={poster}
            alt=""
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </picture>
      )}

      {/* 2. The loop, faded in once it is genuinely moving. */}
      {src && (
        <video
          /* A new key when the screen class changes: <source> children are
             only read when a video element first loads, so turning a phone to
             landscape has to mean a fresh element, not edited children. */
          key={src}
          ref={ref}
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => {
            setPlaying(true)
            setVisible(true)
          }}
          onPause={() => setPlaying(false)}
          className={`hero-video absolute inset-0 h-full w-full object-cover ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {sources!.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      )}

      {/* 3. Always stoppable. */}
      {src && (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? pauseLabel : playLabel}
          title={playing ? pauseLabel : playLabel}
          className="absolute right-4 bottom-4 z-20 grid h-9 w-9 place-items-center rounded-full border border-white/35 bg-black/25 text-white/90 backdrop-blur-sm transition hover:bg-black/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:right-8 md:bottom-8"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="2" y="1.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
              <rect x="7.4" y="1.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 1.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5z" fill="currentColor" />
            </svg>
          )}
        </button>
      )}
    </>
  )
}
