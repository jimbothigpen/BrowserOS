import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'

export async function dispatchClick(
  session: ProtocolApi,
  x: number,
  y: number,
  button: string,
  clickCount: number,
  modifiers: number,
): Promise<void> {
  const btn = button as 'left' | 'middle' | 'right'
  await session.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y })
  await session.Input.dispatchMouseEvent({
    type: 'mousePressed',
    x,
    y,
    button: btn,
    clickCount,
    modifiers,
  })
  await session.Input.dispatchMouseEvent({
    type: 'mouseReleased',
    x,
    y,
    button: btn,
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

export async function dispatchDrag(
  session: ProtocolApi,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  // Phase 1: real mouse drag — covers apps that handle drag via mouse-down/up
  // listeners (canvas-based UIs, custom DnD without HTML5 events).
  await session.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x: from.x,
    y: from.y,
  })
  await session.Input.dispatchMouseEvent({
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    clickCount: 1,
  })
  await session.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x: to.x,
    y: to.y,
  })
  await session.Input.dispatchMouseEvent({
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    clickCount: 1,
  })

  // Phase 2: synthetic HTML5 DragEvent sequence — covers apps using React-DnD
  // and similar libraries that listen for `dragstart`/`dragover`/`drop` rather
  // than raw mouse events. CDP `Input.dispatchMouseEvent` alone does NOT
  // elevate mouse drags into HTML5 drag events, so the React state never
  // updates on drop. The two phases coexist safely: apps that use only one
  // style get a no-op on the other.
  await session.Runtime.evaluate({
    expression: `(() => {
      const fromEl = document.elementFromPoint(${from.x}, ${from.y});
      const toEl = document.elementFromPoint(${to.x}, ${to.y});
      if (!fromEl || !toEl) return false;
      const dt = new DataTransfer();
      const fire = (type, target, x, y) => target.dispatchEvent(
        new DragEvent(type, {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        })
      );
      fire('dragstart', fromEl, ${from.x}, ${from.y});
      fire('dragenter', toEl, ${to.x}, ${to.y});
      fire('dragover', toEl, ${to.x}, ${to.y});
      fire('drop', toEl, ${to.x}, ${to.y});
      fire('dragend', fromEl, ${from.x}, ${from.y});
      return true;
    })()`,
    awaitPromise: false,
  })
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
