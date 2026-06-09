import { useCallback, useEffect, useRef, useState } from 'react'
import { sentry } from '@/lib/sentry/sentry'
import type { ChatBlock, ThoughtItem } from './chat-screen.types'
import {
  DEMO_JITTER,
  DEMO_JITTER_SEED,
  DEMO_SPEED,
  DEMO_TIMING,
  type DemoTimingKey,
} from './demo-config'
import { openProfileTab, openTrendTabs } from './demo-tabs'

export interface DemoDirector {
  blocks: ChatBlock[]
  gateActive: boolean
  founderPlaceholder: string | null
  submitFounderReply: (text: string) => void
}

const nextId = (() => {
  let n = 0
  return () => `demo-${++n}`
})()

const FOUNDER_BRIEF =
  'Post about how AI agents automate the boring work — like marketing. Audience: founders & builders. My exact voice. Draft 5, warm up the account, then publish my pick.'

const append =
  (...add: ChatBlock[]) =>
  (blocks: ChatBlock[]) => [...blocks, ...add]

const finishThought =
  (items: ThoughtItem[]) =>
  (blocks: ChatBlock[]): ChatBlock[] =>
    blocks.map((block) =>
      block.type === 'thought' && block.status === 'running'
        ? {
            ...block,
            status: 'done' as const,
            runningLabel: undefined,
            items,
          }
        : block,
    )

const updateWarmup =
  (patch: Partial<{ progress: number; done: boolean; expanded: boolean }>) =>
  (blocks: ChatBlock[]): ChatBlock[] =>
    blocks.map((block) =>
      block.type === 'warmup' ? { ...block, ...patch } : block,
    )

type DemoBeat = {
  gap: DemoTimingKey
  apply?: (blocks: ChatBlock[]) => ChatBlock[]
  effect?: () => Promise<void>
}

type DemoSegment = { beats: DemoBeat[] }
type DemoGate = { scriptedFounderText: string }

type DemoTimeline = {
  segments: DemoSegment[]
  gates: DemoGate[]
}

const makeRng = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const effectiveDelay = (key: DemoTimingKey, rng: () => number): number => {
  const base = DEMO_TIMING[key] * DEMO_SPEED
  if (DEMO_JITTER <= 0) return Math.round(base)
  const factor = 1 + (rng() * 2 - 1) * DEMO_JITTER
  return Math.round(base * factor)
}

const trendsDoneItems: ThoughtItem[] = [
  { text: 'Opened linkedin.com — feed loaded' },
  { text: 'Scanned 40+ recent posts in your space' },
  { text: 'Pulled 6 recurring themes and a clear open lane' },
]

const toneDoneItems: ThoughtItem[] = [
  { text: 'Opened your LinkedIn profile' },
  { text: 'Read your last 20 posts and comments' },
  { text: 'Modeled your voice: direct, lowercase, specific, no hype' },
]

const draftDoneItems: ThoughtItem[] = [
  { text: 'Wrote 5 drafts in your voice' },
  { text: 'Created a Google Doc and saved them there' },
]

const buildTimeline = (): DemoTimeline => ({
  segments: [
    {
      beats: [
        {
          gap: 'bootPause',
          apply: append({
            type: 'thought',
            id: nextId(),
            status: 'done',
            note: "Here's my plan. Starting with research.",
            items: [
              {
                text: 'Read the brief and pulled context from your voice notes',
              },
              {
                text: 'Broke this into 4 steps: research trends → learn your tone → draft 5 → warm up & publish',
              },
            ],
          }),
        },
        {
          gap: 'thinkBeforeThought',
          apply: append({
            type: 'thought',
            id: nextId(),
            status: 'running',
            runningLabel: 'Extracting trends',
            items: [
              { text: 'Opened linkedin.com — feed loaded' },
              {
                text: 'Reading the automation & AI-agents space',
                running: true,
              },
            ],
          }),
          effect: openTrendTabs,
        },
        {
          gap: 'thoughtRunDuration',
          apply: (blocks) =>
            append(
              { type: 'trends', id: nextId() },
              {
                type: 'note',
                id: nextId(),
                text: "Clear lane: 'boring work first', brutally specific, no emoji. Now I'll learn your voice.",
              },
            )(finishThought(trendsDoneItems)(blocks)),
        },
        {
          gap: 'betweenPhases',
          apply: append({
            type: 'thought',
            id: nextId(),
            status: 'running',
            runningLabel: 'Extracting tone & style',
            items: [
              { text: 'Opened your LinkedIn profile' },
              {
                text: 'Reading your last 20 posts and comments',
                running: true,
              },
            ],
          }),
          effect: openProfileTab,
        },
        {
          gap: 'thoughtRunDuration',
          apply: (blocks) =>
            append(
              { type: 'tone', id: nextId() },
              {
                type: 'note',
                id: nextId(),
                text: 'Locked your voice. Writing five drafts now.',
              },
            )(finishThought(toneDoneItems)(blocks)),
        },
        {
          gap: 'betweenPhases',
          apply: append({
            type: 'thought',
            id: nextId(),
            status: 'running',
            runningLabel: 'Drafting 5 posts',
            items: [
              { text: 'Writing hooks against the open lane' },
              {
                text: 'Matching your sentence rhythm and CTAs',
                running: true,
              },
            ],
          }),
        },
        {
          gap: 'draftRunDuration',
          apply: (blocks) =>
            append(
              {
                type: 'note',
                id: nextId(),
                text: 'These are your 5 posts — draft 1 is my pick for the awareness goal. Want any changes, or should I publish?',
              },
              { type: 'posts', id: nextId() },
            )(finishThought(draftDoneItems)(blocks)),
        },
      ],
    },
    {
      beats: [
        {
          gap: 'editRunDuration',
          apply: append(
            {
              type: 'note',
              id: nextId(),
              text: 'Tightened draft 2 — sharper first line, dropped the salesy close. Updated the doc too.',
            },
            { type: 'posts', id: nextId(), editedId: 'p2' },
          ),
        },
      ],
    },
    {
      beats: [
        {
          gap: 'beforeWarmup',
          apply: append(
            {
              type: 'note',
              id: nextId(),
              text: "Before I publish, I'll warm up your account — genuine comments on 15 relevant posts in your voice. Lifts early reach.",
            },
            {
              type: 'warmup',
              id: nextId(),
              progress: 0,
              done: false,
              expanded: false,
            },
          ),
        },
        {
          gap: 'warmupTick',
          apply: updateWarmup({ progress: 8 }),
        },
        {
          gap: 'warmupTick',
          apply: updateWarmup({ progress: 15, done: true, expanded: true }),
        },
        {
          gap: 'beforePublish',
          apply: append({
            type: 'note',
            id: nextId(),
            text: 'Warm-up done. Publishing draft 1 now.',
          }),
        },
        {
          gap: 'publishGap',
          apply: append({
            type: 'note',
            id: nextId(),
            text: "Published. It's live and already getting reactions.",
          }),
        },
        {
          gap: 'successGap',
          apply: append({ type: 'success', id: nextId() }),
        },
      ],
    },
  ],
  gates: [
    {
      scriptedFounderText:
        'Make draft 2 punchier — tighter hook, and cut anything that sounds salesy.',
    },
    { scriptedFounderText: "Perfect. Let's publish draft 1." },
  ],
})

function makeFounderBlock(initialMessage: string | undefined): ChatBlock {
  return {
    type: 'founder',
    id: nextId(),
    text: initialMessage?.trim() ? initialMessage.trim() : FOUNDER_BRIEF,
  }
}

export function useDemoDirector(
  initialMessage: string | undefined,
  enabled: boolean,
): DemoDirector {
  const [blocks, setBlocks] = useState<ChatBlock[]>(() => [
    makeFounderBlock(initialMessage),
  ])
  const [segmentIndex, setSegmentIndex] = useState(0)
  const [gateActive, setGateActive] = useState(false)
  const rngRef = useRef(makeRng(DEMO_JITTER_SEED))
  const timelineRef = useRef<DemoTimeline | null>(null)
  const lastInitialRef = useRef(initialMessage)

  if (!timelineRef.current) timelineRef.current = buildTimeline()

  // Reset session state when initialMessage changes between renders. This
  // lets the hook stay mounted across session restarts so consumers (the
  // hoisted composer's motion.div) don't remount and lose their layout
  // baseline. React docs sanction setState-during-render specifically for
  // this "derive state from props" reset pattern.
  if (lastInitialRef.current !== initialMessage) {
    lastInitialRef.current = initialMessage
    setBlocks([makeFounderBlock(initialMessage)])
    setSegmentIndex(0)
    setGateActive(false)
    rngRef.current = makeRng(DEMO_JITTER_SEED)
    timelineRef.current = buildTimeline()
  }

  useEffect(() => {
    if (!enabled) return
    const timeline = timelineRef.current
    const segment = timeline?.segments[segmentIndex]
    if (!timeline || !segment) return

    const timers: ReturnType<typeof setTimeout>[] = []
    let acc = 0
    for (const beat of segment.beats) {
      acc += effectiveDelay(beat.gap, rngRef.current)
      timers.push(
        setTimeout(() => {
          if (beat.apply) setBlocks(beat.apply)
          if (beat.effect) {
            Promise.resolve(beat.effect()).catch((err) =>
              sentry.captureException(err, {
                extra: { message: 'demo-director effect failed' },
              }),
            )
          }
        }, acc),
      )
    }

    if (segmentIndex < timeline.gates.length) {
      acc += effectiveDelay('beforeGate', rngRef.current)
      timers.push(setTimeout(() => setGateActive(true), acc))
    }

    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [enabled, segmentIndex])

  const submitFounderReply = useCallback(
    (text: string) => {
      if (!gateActive) return
      const timeline = timelineRef.current
      const scripted = timeline?.gates[segmentIndex]?.scriptedFounderText ?? ''
      const finalText = text.trim() || scripted
      setBlocks((blocks) => [
        ...blocks,
        { type: 'founder', id: nextId(), text: finalText },
      ])
      setGateActive(false)
      setSegmentIndex((i) => i + 1)
    },
    [gateActive, segmentIndex],
  )

  const founderPlaceholder = gateActive
    ? (timelineRef.current?.gates[segmentIndex]?.scriptedFounderText ?? null)
    : null

  return { blocks, gateActive, founderPlaceholder, submitFounderReply }
}
