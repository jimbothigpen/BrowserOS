export type ChatMode = 'text' | 'voice'

export interface FounderBlock {
  type: 'founder'
  id: string
  text: string
}

export interface AgentNoteBlock {
  type: 'note'
  id: string
  text: string
}

export interface ThoughtItem {
  text: string
  running?: boolean
}

export interface ThoughtBlock {
  type: 'thought'
  id: string
  status: 'running' | 'done'
  runningLabel?: string
  items: ThoughtItem[]
  note?: string
}

export interface TrendsBlock {
  type: 'trends'
  id: string
}

export interface ToneBlock {
  type: 'tone'
  id: string
}

export interface PostsBlock {
  type: 'posts'
  id: string
}

export interface WarmupBlock {
  type: 'warmup'
  id: string
  progress: number
  done: boolean
  expanded: boolean
}

export interface SuccessBlock {
  type: 'success'
  id: string
}

export type ChatBlock =
  | FounderBlock
  | AgentNoteBlock
  | ThoughtBlock
  | TrendsBlock
  | ToneBlock
  | PostsBlock
  | WarmupBlock
  | SuccessBlock

export interface VoiceTurn {
  who: 'agent' | 'founder'
  text: string
}
