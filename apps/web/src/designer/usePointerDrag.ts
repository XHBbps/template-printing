import { useDesignerStore } from '../stores/designer';

type ResizeSide = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export function usePointerDrag(
  elementId: string,
  getDom: () => HTMLElement | null,
): {
  onGripDown: (e: PointerEvent) => void;
  onResizeDown: (side: ResizeSide, e: PointerEvent) => void;
} {
  const store = useDesignerStore();

  function getCellPx(): { w: number; h: number } {
    return {
      w: store.template.canvas.cell.w,
      h: store.template.canvas.cell.h,
    };
  }

  function getElement() {
    return store.template.elements.find((e) => e.id === elementId);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  // Smooth move (#4): during pointermove track raw pixel delta and apply it via
  // CSS transform. The store's grid stays fixed, so positionStyle (left/top) is
  // unchanged. On pointerup we compute the snapped grid, set transform to the
  // residue between cursor pixel and snapped grid pixel (so the element does
  // not visually jump), commit the new grid, then on the next frame clear the
  // transform — the transform transition slides the element home.
  function onGripDown(e: PointerEvent): void {
    const dom = getDom();
    const el = getElement();
    if (!dom || !el) return;
    const cell = getCellPx();
    const startC = el.grid.c;
    const startR = el.grid.r;
    const startCs = el.grid.cs;
    const startRs = el.grid.rs;
    const startX = e.clientX;
    const startY = e.clientY;

    let lastDx = 0;
    let lastDy = 0;

    store.isResizing = true;
    dom.classList.add('is-pointer-active');

    function onMove(ev: PointerEvent): void {
      lastDx = ev.clientX - startX;
      lastDy = ev.clientY - startY;
      dom!.style.transform = `translate(${lastDx}px, ${lastDy}px)`;
    }

    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      const dc = Math.round(lastDx / cell.w);
      const dr = Math.round(lastDy / cell.h);
      const newC = clamp(startC + dc, 0, store.template.canvas.cols - startCs);
      const newR = clamp(startR + dr, 0, store.template.canvas.rows - startRs);

      // Residue in px between raw cursor and snapped grid — keeps the element
      // visually pinned at the cursor while we swap grid underneath.
      const residueX = lastDx - (newC - startC) * cell.w;
      const residueY = lastDy - (newR - startR) * cell.h;

      // Step 1: lock element to residue (no visible change at the moment
      // because transitions are disabled).
      dom!.style.transform = `translate(${residueX}px, ${residueY}px)`;
      // Step 2: commit new grid synchronously — left/top jump to new cell
      // but the residue transform keeps the visible position fixed.
      store.moveElement(elementId, newC, newR);

      // Step 3: next frame, re-enable transitions and animate transform to 0.
      requestAnimationFrame(() => {
        dom!.classList.remove('is-pointer-active');
        dom!.style.transform = '';
      });

      store.isResizing = false;
      store.commit();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Resize keeps per-cell snapping during pointermove (current behavior).
  // The user's #4 was specifically about *move*, not resize, and pure-pixel
  // resize would require inline width/height overrides that fight the bound
  // :style. Snapping per cell during resize is acceptable visual feedback.
  function onResizeDown(side: ResizeSide, e: PointerEvent): void {
    const el = getElement();
    if (!el) return;
    const cell = getCellPx();
    const startC = el.grid.c;
    const startR = el.grid.r;
    const startCs = el.grid.cs;
    const startRs = el.grid.rs;
    const startX = e.clientX;
    const startY = e.clientY;

    store.isResizing = true;

    function onMove(ev: PointerEvent): void {
      const dc = Math.round((ev.clientX - startX) / cell.w);
      const dr = Math.round((ev.clientY - startY) / cell.h);
      let newC = startC;
      let newR = startR;
      let newCs = startCs;
      let newRs = startRs;

      if (side.includes('w')) {
        newC = clamp(startC + dc, 0, startC + startCs - 1);
        newCs = startCs - (newC - startC);
      } else if (side.includes('e')) {
        newCs = clamp(startCs + dc, 1, store.template.canvas.cols - startC);
      }
      if (side.includes('n')) {
        newR = clamp(startR + dr, 0, startR + startRs - 1);
        newRs = startRs - (newR - startR);
      } else if (side.includes('s')) {
        newRs = clamp(startRs + dr, 1, store.template.canvas.rows - startR);
      }
      store.resizeElement(elementId, newCs, newRs, newC, newR);
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      store.isResizing = false;
      store.commit();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return { onGripDown, onResizeDown };
}
