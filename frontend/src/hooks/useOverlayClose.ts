import { useRef, type MouseEvent } from 'react'

/**
 * Backdrop click-to-close handlers for a modal. A plain `onClick` check of
 * `e.target === e.currentTarget` isn't enough: starting a drag inside the
 * modal (e.g. a range slider) and releasing the mouse over the backdrop
 * fires a click event whose target is the backdrop itself — browsers
 * dispatch `click` on the nearest common ancestor of the mousedown and
 * mouseup targets — which closes the modal mid-drag. Requiring the
 * mousedown to *also* have started on the backdrop fixes that.
 */
export function useOverlayClose(onClose: () => void) {
  const mouseDownOnOverlay = useRef(false)

  return {
    onMouseDown: (e: MouseEvent) => {
      mouseDownOnOverlay.current = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent) => {
      if (mouseDownOnOverlay.current && e.target === e.currentTarget) {
        onClose()
      }
    },
  }
}
