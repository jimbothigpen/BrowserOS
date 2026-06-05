import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import type { Observer } from '../observer/observer'
import type { PageManager } from '../pages'
import {
  callOnElement,
  focusElement,
  getElementCenter,
  getInputValue,
  jsClick,
  scrollIntoView,
} from './geometry'
import { clearField, pressCombo, typeText } from './keyboard'
import {
  dispatchClick,
  dispatchHover,
  dispatchScroll,
  type MouseButton,
} from './mouse'

export interface ClickOptions {
  button?: MouseButton
  clickCount?: number
}

export type ScrollDirection = 'up' | 'down' | 'left' | 'right'

const SELECT_OPTION_FN = `function(val){
  for(var i=0;i<this.options.length;i++){
    if(this.options[i].value===val||this.options[i].textContent.trim()===val){
      this.selectedIndex=i;
      this.dispatchEvent(new Event('change',{bubbles:true}));
      return this.options[i].textContent.trim();
    }
  }
  return null;
}`

/**
 * The action layer over a page's refs. Mouse/scroll dispatch on the element's (frame) session
 * in that session's coordinates; keyboard dispatches on the page session against whatever the
 * focus moved to — the asymmetry CDP requires for OOPIFs (a no-op on the main frame).
 */
export class Input {
  constructor(
    private readonly observer: Observer,
    private readonly pages: PageManager,
    private readonly pageId: number,
  ) {}

  async click(ref: string, opts: ClickOptions = {}): Promise<void> {
    const { session, backendNodeId } = await this.observer.resolveRef(ref)
    await scrollIntoView(session, backendNodeId)
    try {
      const { x, y } = await getElementCenter(session, backendNodeId)
      await dispatchClick(
        session,
        x,
        y,
        opts.button ?? 'left',
        opts.clickCount ?? 1,
        0,
      )
    } catch {
      // No geometry (hidden/zero-size) — fall back to a synthetic DOM click.
      await jsClick(session, backendNodeId)
    }
  }

  async hover(ref: string): Promise<void> {
    const { session, backendNodeId } = await this.observer.resolveRef(ref)
    await scrollIntoView(session, backendNodeId)
    const { x, y } = await getElementCenter(session, backendNodeId)
    await dispatchHover(session, x, y)
  }

  async fill(
    ref: string,
    value: string,
    opts: { clear?: boolean } = {},
  ): Promise<void> {
    const { session, backendNodeId } = await this.observer.resolveRef(ref)
    await scrollIntoView(session, backendNodeId)

    // A real click is the most reliable way to focus shadow-DOM/custom inputs.
    let coords: { x: number; y: number } | undefined
    try {
      coords = await getElementCenter(session, backendNodeId)
      await dispatchClick(session, coords.x, coords.y, 'left', 1, 0)
    } catch {
      await focusElement(session, backendNodeId)
    }

    const keys = await this.pageSession()
    if (opts.clear !== false) {
      await clearField(keys)
      if (coords && (await getInputValue(session, backendNodeId))) {
        // Still populated — triple-click to select all, then overwrite.
        await dispatchClick(session, coords.x, coords.y, 'left', 3, 0)
      }
    }
    await typeText(keys, value)
  }

  async type(text: string): Promise<void> {
    await typeText(await this.pageSession(), text)
  }

  async press(key: string): Promise<void> {
    await pressCombo(await this.pageSession(), key)
  }

  async selectOption(ref: string, value: string): Promise<string | null> {
    const { session, backendNodeId } = await this.observer.resolveRef(ref)
    const selected = await callOnElement(
      session,
      backendNodeId,
      SELECT_OPTION_FN,
      [value],
    )
    return (selected as string | null) ?? null
  }

  async scroll(
    direction: ScrollDirection,
    amount = 3,
    ref?: string,
  ): Promise<void> {
    const pixels = amount * 120
    const deltaX =
      direction === 'left' ? -pixels : direction === 'right' ? pixels : 0
    const deltaY =
      direction === 'up' ? -pixels : direction === 'down' ? pixels : 0
    if (deltaX === 0 && deltaY === 0) return

    if (ref) {
      const { session, backendNodeId } = await this.observer.resolveRef(ref)
      const { x, y } = await getElementCenter(session, backendNodeId)
      await dispatchScroll(session, x, y, deltaX, deltaY)
      return
    }

    const session = await this.pageSession()
    const metrics = await session.Page.getLayoutMetrics()
    const x = metrics.layoutViewport.clientWidth / 2
    const y = metrics.layoutViewport.clientHeight / 2
    await dispatchScroll(session, x, y, deltaX, deltaY)
  }

  private async pageSession(): Promise<ProtocolApi> {
    return (await this.pages.getSession(this.pageId)).session
  }
}
