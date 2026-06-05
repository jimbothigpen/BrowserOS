import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'

export type MouseButton = 'left' | 'middle' | 'right'

export async function dispatchClick(
  session: ProtocolApi,
  x: number,
  y: number,
  button: MouseButton,
  clickCount: number,
  modifiers: number,
): Promise<void> {
  await session.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y })
  await session.Input.dispatchMouseEvent({
    type: 'mousePressed',
    x,
    y,
    button,
    clickCount,
    modifiers,
  })
  await session.Input.dispatchMouseEvent({
    type: 'mouseReleased',
    x,
    y,
    button,
    clickCount,
    modifiers,
  })
}

export async function dispatchHover(
  session: ProtocolApi,
  x: number,
  y: number,
): Promise<void> {
  await session.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y })
}

export async function dispatchScroll(
  session: ProtocolApi,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await session.Input.dispatchMouseEvent({
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
  })
}
