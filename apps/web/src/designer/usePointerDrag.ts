import { useDesignerStore } from '../stores/designer';

type ResizeSide = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export function usePointerDrag(elementId: string): {
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

  function onGripDown(e: PointerEvent): void {
    const el = getElement();
    if (!el) return;
    const startCell = getCellPx();
    const startC = el.grid.c;
    const startR = el.grid.r;
    const startCs = el.grid.cs;
    const startRs = el.grid.rs;
    const startX = e.clientX;
    const startY = e.clientY;

    store.isResizing = true;

    function onMove(ev: PointerEvent): void {
      const dc = Math.round((ev.clientX - startX) / startCell.w);
      const dr = Math.round((ev.clientY - startY) / startCell.h);
      const newC = clamp(startC + dc, 0, store.template.canvas.cols - startCs);
      const newR = clamp(startR + dr, 0, store.template.canvas.rows - startRs);
      store.moveElement(elementId, newC, newR);
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

  function onResizeDown(side: ResizeSide, e: PointerEvent): void {
    const el = getElement();
    if (!el) return;
    const startCell = getCellPx();
    const startC = el.grid.c;
    const startR = el.grid.r;
    const startCs = el.grid.cs;
    const startRs = el.grid.rs;
    const startX = e.clientX;
    const startY = e.clientY;

    store.isResizing = true;

    function onMove(ev: PointerEvent): void {
      const dc = Math.round((ev.clientX - startX) / startCell.w);
      const dr = Math.round((ev.clientY - startY) / startCell.h);
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
