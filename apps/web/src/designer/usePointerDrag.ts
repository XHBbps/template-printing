import { useDesignerStore } from '../stores/designer';

type ResizeSide = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
type ResizeMode = 'free' | 'qr-lock' | 'barcode';

export function usePointerDrag(
  elementId: string,
  getDom: () => HTMLElement | null,
): {
  onGripDown: (e: PointerEvent) => void;
  onResizeDown: (side: ResizeSide, e: PointerEvent) => void;
} {
  const store = useDesignerStore();

  function getCellPx(): { w: number; h: number } {
    return { w: store.template.canvas.cell.w, h: store.template.canvas.cell.h };
  }
  function getElement() {
    return store.template.elements.find((e) => e.id === elementId);
  }
  function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }
  function getResizeMode(): ResizeMode {
    const el = getElement();
    if (!el || el.type !== 'barcode') return 'free';
    return el.symbology === 'qr' ? 'qr-lock' : 'barcode';
  }

  function onGripDown(e: PointerEvent): void {
    const dom = getDom();
    const el = getElement();
    if (!dom || !el) return;
    const cell = getCellPx();
    const startC = el.grid.c,
      startR = el.grid.r;
    const startCs = el.grid.cs,
      startRs = el.grid.rs;
    const startX = e.clientX,
      startY = e.clientY;

    let lastDx = 0,
      lastDy = 0;
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
      const residueX = lastDx - (newC - startC) * cell.w;
      const residueY = lastDy - (newR - startR) * cell.h;
      dom!.style.transform = `translate(${residueX}px, ${residueY}px)`;
      store.moveElement(elementId, newC, newR);
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

  function onResizeDown(side: ResizeSide, e: PointerEvent): void {
    const el = getElement();
    if (!el) return;
    const cell = getCellPx();
    const startC = el.grid.c,
      startR = el.grid.r;
    const startCs = el.grid.cs,
      startRs = el.grid.rs;
    const startX = e.clientX,
      startY = e.clientY;
    const mode = getResizeMode();

    store.isResizing = true;

    function onMove(ev: PointerEvent): void {
      let dcPx = ev.clientX - startX;
      let drPx = ev.clientY - startY;

      // QR 1:1 lock: take the larger axis magnitude, apply to both.
      if (mode === 'qr-lock') {
        const basis = Math.max(Math.abs(dcPx), Math.abs(drPx));
        const sx = dcPx >= 0 ? 1 : -1;
        const sy = drPx >= 0 ? 1 : -1;
        dcPx = sx * basis;
        drPx = sy * basis;
      }

      let dc = Math.round(dcPx / cell.w);
      let dr = Math.round(drPx / cell.h);

      // For QR force dc === dr (in cell units) — snap to the largest absolute.
      if (mode === 'qr-lock') {
        const d = Math.max(Math.abs(dc), Math.abs(dr));
        dc = (dc >= 0 ? 1 : -1) * d;
        dr = (dr >= 0 ? 1 : -1) * d;
      }

      let newC = startC,
        newR = startR,
        newCs = startCs,
        newRs = startRs;

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

      // 1D barcode: enforce min rs >= 2
      if (mode === 'barcode' && newRs < 2) {
        if (side.includes('n')) {
          newR = startR + startRs - 2;
          newRs = 2;
        } else {
          newRs = 2;
        }
      }

      // QR: enforce cs === rs strictly. Use the smaller of the two as final.
      if (mode === 'qr-lock') {
        const final = Math.min(newCs, newRs);
        newCs = final;
        newRs = final;
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
