import type { FC } from 'react'
import { BrowserOsAiPane } from './BrowserOsAiPane'

/**
 * AI & Agents settings page. Flat single-pane LLM-providers UI: ACP
 * coding agents (Claude Code, Codex, custom ACP) live as provider
 * entries in the same dropdown as Anthropic / OpenAI / etc., so the
 * per-adapter tabs that used to live here are gone.
 */
export const AISettingsPage: FC = () => {
  return <BrowserOsAiPane />
}
