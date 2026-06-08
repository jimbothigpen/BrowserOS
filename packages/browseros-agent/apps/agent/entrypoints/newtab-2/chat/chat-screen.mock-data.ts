import type { VoiceTurn } from './chat-screen.types'

export const VOICE_TURNS: VoiceTurn[] = [
  { who: 'agent', text: 'What do you want to post about today?' },
  {
    who: 'founder',
    text: "I want to post about how AI agents can automate the boring parts of running a company, marketing being the obvious one. We're BrowserOS.",
  },
  {
    who: 'agent',
    text: 'Got it. Who are we talking to, other founders, or a broader tech crowd?',
  },
  {
    who: 'founder',
    text: 'Founders and early-stage builders, mostly. People who feel the marketing grind.',
  },
  { who: 'agent', text: 'And the goal of the post, signups, or awareness?' },
  {
    who: 'founder',
    text: 'Awareness, with a soft nudge to try BrowserOS. Nothing salesy.',
  },
  {
    who: 'agent',
    text: 'Last thing, should I match your usual LinkedIn voice, or try something new?',
  },
  {
    who: 'founder',
    text: 'Match my tone exactly. Direct, no hype, no emoji.',
  },
  {
    who: 'agent',
    text: "Perfect. I'll study the automation space, learn your voice from your last posts, and draft five. Kicking off now.",
  },
]

export interface TrendFinding {
  tag: 'rising' | 'hot' | 'signal'
  text: string
}

export const TRENDS: TrendFinding[] = [
  {
    tag: 'rising',
    text: '"AI employees" reframed as workflows, not chatbots. Posts that name a specific boring task outperform abstract ones 4:1.',
  },
  {
    tag: 'hot',
    text: 'Founders sharing what they personally stopped doing get 3x the saves of feature announcements.',
  },
  {
    tag: 'rising',
    text: '"Automate the boring" angle is crowded. The winning version is brutally specific (one task, one number).',
  },
  {
    tag: 'signal',
    text: 'Short, punchy first lines with a concrete claim beat "thought-leader" intros. No emoji on top performers.',
  },
  {
    tag: 'signal',
    text: 'Marketing-ops automation is under-discussed vs eng automation. Open lane for a founder POV.',
  },
]

export const TONE_NOTES = [
  'Direct, declarative sentences. No exclamation marks.',
  'Lowercase product references, specific numbers in-line.',
  'Opens with a claim or a confession, never a question.',
  'Short paragraphs, lots of line breaks.',
  'No emoji. No "excited to share". Ends on a small, dry CTA.',
]

export interface MockPost {
  id: string
  title: string
  pinned?: boolean
  bodyFirstLine: string
}

export const POSTS: MockPost[] = [
  {
    id: 'p1',
    title: 'The marketing one',
    pinned: true,
    bodyFirstLine: 'I stopped writing my own LinkedIn posts three weeks ago.',
  },
  {
    id: 'p2',
    title: 'The punchy hook',
    bodyFirstLine: 'Marketing is the most automatable job at most startups.',
  },
  {
    id: 'p3',
    title: 'The contrarian take',
    bodyFirstLine:
      'Hot take: most "AI employee" demos are fake because they automate the impressive work and leave you the boring work.',
  },
  {
    id: 'p4',
    title: 'The story',
    bodyFirstLine:
      'A founder I know spends four hours a week on LinkedIn. Researching, writing, second-guessing, scheduling.',
  },
  {
    id: 'p5',
    title: 'The builder note',
    bodyFirstLine:
      'We give every agent its own browser profile, so it can only touch what you scoped.',
  },
]

export const WARMUP_TOTAL = 15
