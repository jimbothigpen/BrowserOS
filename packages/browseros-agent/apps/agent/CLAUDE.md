# BrowserOS Agent UI contributor ground rules

The agent UI is a WXT React extension: side panel chat, app/settings pages, new tab, onboarding, background workers, and content scripts.

## Before you push

From the monorepo root:

```
bun run lint
bun run typecheck
bun run build:agent
```

For focused agent UI work:

```
cd apps/agent && bun run typecheck
cd apps/agent && bun run test
cd apps/agent && bun run codegen
```

## Project shape

```
apps/agent/
|- entrypoints/
|  |- sidepanel/     Chat UI
|  |- app/           Settings, AI providers, agents, MCP, usage
|  |- newtab/        BrowserOS new tab UI
|  |- onboarding/    First-run flow
|  |- background/    Extension background logic
|  `- *.content*     Page/content integrations
|- components/       Shared UI, including generated shadcn-style primitives
|- generated/graphql GraphQL codegen output
|- lib/              Auth, GraphQL, metrics, Sentry, BrowserOS clients, state
|- schema/           Default GraphQL schema input
`- wxt.config.ts     Manifest and WXT/Vite config
```

## WXT and entrypoints

- `wxt.config.ts` owns manifest shape, permissions, side panel/new tab/options wiring, extension ID, externally connectable hosts, and Vite plugins.
- `entrypoints/sidepanel/main.tsx` is the side panel entry.
- `entrypoints/app/main.tsx` is the extension app/settings entry.
- `entrypoints/newtab/` owns the new tab experience.
- `entrypoints/background/` owns background jobs and extension-level listeners.
- Content entrypoints live under `entrypoints/*.content*`; keep page integration logic there, not in shared UI components.

## UI conventions

- Folders are kebab-case. React component files are PascalCase. Hooks use a `use` prefix. Single-word utility/model files stay lowercase.
- Avoid `useCallback` and `useMemo` unless they solve a measured or obvious render problem.
- Use existing shadcn-style primitives from `components/ui/` for UI controls.
- Capture runtime errors with Sentry, not `console.error`:

```
import { sentry } from '@/lib/sentry/sentry'

sentry.captureException(error, {
  extra: { message: 'Failed to fetch graph data from the server' },
})
```

## GraphQL and codegen

- Codegen input defaults to `schema/schema.graphql`; set `GRAPHQL_SCHEMA_PATH` when you need an external schema.
- Generated files live in `generated/graphql/`; do not hand-edit them.
- Put GraphQL documents in a local `graphql/` folder near the feature using them.
- Import documents with `graphql` from `@/generated/graphql/gql`.
- Use the existing helpers in `lib/graphql/`: `useGraphqlQuery`, `useGraphqlMutation`, `useGraphqlInfiniteQuery`, and `getQueryKeyFromDocument`.
- After adding or changing a document, run:

```
cd apps/agent && bun run codegen
```

## Analytics

- Event constants live in `lib/constants/analyticsEvents.ts`.
- Event constants use `SCREAMING_SNAKE_CASE` ending in `_EVENT`.
- Add `/** @public */` above each exported event constant.
- Event values follow `<area>.<entity>.<action>` such as `ui.message.like` or `settings.managed_mcp.added`.
- Always call `track()` with an event constant; never pass raw event strings.

## Self-testing UI changes

Use the CDP inspector when changing extension UI. It can inspect extension pages that the agent tools cannot see.

Start the dev environment and read the randomized CDP port:

```
bun run dev:watch -- --new
export BROWSEROS_CDP_PORT=<port from output>
```

Useful inspector commands:

```
bun scripts/dev/inspect-ui.ts targets
bun scripts/dev/inspect-ui.ts open-sidepanel
bun scripts/dev/inspect-ui.ts snapshot sidepanel
bun scripts/dev/inspect-ui.ts screenshot sidepanel /tmp/panel.png
bun scripts/dev/inspect-ui.ts click sidepanel <backendDOMNodeId>
bun scripts/dev/inspect-ui.ts fill sidepanel <backendDOMNodeId> "search query"
bun scripts/dev/inspect-ui.ts press_key sidepanel Enter
bun scripts/dev/inspect-ui.ts eval sidepanel "document.title"
```

The normal loop is `snapshot -> click/fill/press_key -> screenshot`. Element IDs are the `[number]` values from the snapshot output.
