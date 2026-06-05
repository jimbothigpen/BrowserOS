import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import type { FrameId } from '../connection'
import type { PageManager } from '../pages'
import { diffSnapshots, type SnapshotDiff } from '../snapshot/diff'
import { RefMap } from '../snapshot/refs'
import { renderSnapshot } from '../snapshot/render'
import { fetchAxTree } from './ax-tree'
import { findCursorHits } from './cursor-augment'
import type { FrameRegistry } from './frames'
import { type ResolvedElement, resolveRefEntry } from './resolve'

const MAX_FRAME_DEPTH = 5

export interface SnapshotResult {
  text: string
  refs: RefMap
}

/**
 * Per-page observation. Renders the accessibility tree (stitched across iframes into one tree
 * with a single global ref namespace) and diffs successive observations against a stored
 * baseline. Holds the last RefMap so refs can be resolved through the right frame session.
 */
export class Observer {
  private baseline = ''
  private refs = new RefMap()

  constructor(
    private readonly pages: PageManager,
    private readonly frames: FrameRegistry,
    private readonly pageId: number,
  ) {}

  async snapshot(): Promise<SnapshotResult> {
    const result = await this.capture()
    this.commit(result)
    return result
  }

  async diff(): Promise<SnapshotDiff> {
    const before = this.baseline
    const result = await this.capture()
    this.commit(result)
    return diffSnapshots(before, result.text)
  }

  get lastRefs(): RefMap {
    return this.refs
  }

  /** Resolve a ref from the last snapshot to a live element, routed to its frame's session. */
  async resolveRef(ref: string): Promise<ResolvedElement> {
    const entry = this.refs.get(ref)
    if (!entry) {
      throw new Error(`Unknown ref ${ref}; take a new snapshot.`)
    }
    await this.pages.getSession(this.pageId)
    const { session, axParams } = this.frames.resolveFrameTarget(
      this.pageId,
      entry.frameId,
    )
    return resolveRefEntry(session, entry, axParams)
  }

  private async capture(): Promise<SnapshotResult> {
    // Ensure the page session is attached + registered with the frame tracker.
    await this.pages.getSession(this.pageId)
    const refs = new RefMap()
    const text = await this.captureFrame(undefined, refs, 0, new Set())
    return { text, refs }
  }

  /** Render a frame, then splice each child iframe's rendered tree under its `- iframe` line. */
  private async captureFrame(
    frameId: FrameId | undefined,
    refs: RefMap,
    baseDepth: number,
    visited: Set<FrameId>,
  ): Promise<string> {
    if (frameId !== undefined) {
      if (visited.has(frameId)) return ''
      visited.add(frameId)
    }

    const { session, axParams } = this.frames.resolveFrameTarget(
      this.pageId,
      frameId,
    )
    const nodes = await fetchAxTree(session, axParams)
    const cursorHits = await findCursorHits(session).catch(
      () => new Map<number, string[]>(),
    )
    const { text, iframes } = renderSnapshot(nodes, {
      refs,
      frameId,
      baseDepth,
      cursorHits,
    })
    if (iframes.length === 0 || baseDepth >= MAX_FRAME_DEPTH) return text

    const lines = text.split('\n')
    // Splice bottom-up so earlier line indices stay valid as we insert.
    for (const stitch of [...iframes].reverse()) {
      const childFrameId = await resolveChildFrameId(
        session,
        stitch.backendNodeId,
      )
      if (!childFrameId) continue
      const childText = await this.captureFrame(
        childFrameId,
        refs,
        stitch.depth + 1,
        visited,
      ).catch(() => '')
      if (childText) lines.splice(stitch.lineIndex + 1, 0, childText)
    }
    return lines.join('\n')
  }

  private commit(result: SnapshotResult): void {
    this.baseline = result.text
    this.refs = result.refs
  }
}

/** Resolve an iframe element to the frameId of its embedded document. */
async function resolveChildFrameId(
  session: ProtocolApi,
  backendNodeId: number,
): Promise<FrameId | undefined> {
  try {
    const described = await session.DOM.describeNode({
      backendNodeId,
      depth: 1,
    })
    const node = described.node as {
      contentDocument?: { frameId?: string }
      frameId?: string
    }
    return node.contentDocument?.frameId ?? node.frameId
  } catch {
    return undefined
  }
}
