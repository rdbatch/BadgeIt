import { useEffect, useRef, useState } from 'react'
import { TAGLINES, FIRST_TAGLINE } from '../constants/taglines'

interface RotatingTaglineProps {
  className?: string
}

const ROTATE_INTERVAL_MS = 3000

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

interface TaglineState {
  current: string
  outgoing: string | null
}

/**
 * Tagline under the BadgeIt header, rotating every 3s. Always shows
 * FIRST_TAGLINE first; after that, cycles a reshuffling random queue of all
 * taglines (FIRST_TAGLINE included as an eligible repeat) indefinitely.
 */
export function RotatingTagline({ className = '' }: RotatingTaglineProps) {
  const [state, setState] = useState<TaglineState>({ current: FIRST_TAGLINE, outgoing: null })
  const queueRef = useRef<string[]>([])

  function nextTagline(): string {
    if (queueRef.current.length === 0) {
      queueRef.current = shuffle(TAGLINES)
    }
    return queueRef.current.shift()!
  }

  useEffect(() => {
    const id = setInterval(() => {
      setState((prev) => ({ current: nextTagline(), outgoing: prev.current }))
    }, ROTATE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="mt-2 grid h-14 place-items-center overflow-hidden text-center leading-tight">
      {state.outgoing !== null && (
        <span
          key={`out-${state.outgoing}`}
          aria-hidden="true"
          className={`col-start-1 row-start-1 animate-[tagline-out_300ms_ease-in_forwards] text-sm ${className}`}
          onAnimationEnd={() => setState((prev) => ({ ...prev, outgoing: null }))}
        >
          {state.outgoing}
        </span>
      )}
      <span
        key={`in-${state.current}`}
        className={`col-start-1 row-start-1 animate-[tagline-in_300ms_ease-out_forwards] text-sm ${className}`}
      >
        {state.current}
      </span>
    </div>
  )
}
