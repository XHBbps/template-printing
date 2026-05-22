import { useDesignerStore } from '../stores/designer';

import { minMmFor } from './elementFactory';
import { computeSnap } from './snapGuides';

const PX_PER_MM = 4;
const SNAP_THRESHOLD_MM = 1.5;

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
    if (!el) return 'free';
    if (el.type === 'qr') return 'qr-lock';
    if (el.type === 'barcode') return 'barcode';
    return 'free';
  }

  function onGripDown(e: PointerEvent): void {
    const dom = getDom();
    const el = getElement();
    if (!dom || !el) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startAnchorX = el.anchor.x;
    const startAnchorY = el.anchor.y;
    const elW = el.anchor.w;
    const elH = el.anchor.h;
    const paperW = store.paperPx.w / PX_PER_MM;
    const paperH = store.paperPx.h / PX_PER_MM;
    store.isResizing = true;
    dom.classList.add('is-pointer-active');

    function onMove(ev: PointerEvent): void {
      const dxMm = (ev.clientX - startX) / (PX_PER_MM * store.view.zoom);
      const dyMm = (ev.clientY - startY) / (PX_PER_MM * store.view.zoom);

      const others = store.template.elements
        .filter((e2) => e2.id !== elementId)
        .map((e2) => ({ x: e2.anchor.x, y: e2.anchor.y, w: e2.anchor.w, h: e2.anchor.h }));

      const snap = computeSnap({
        target: { x: startAnchorX + dxMm, y: startAnchorY + dyMm, w: elW, h: elH },
        others,
        paper: { w: paperW, h: paperH },
        threshold: ev.altKey ? 0 : SNAP_THRESHOLD_MM,
      });
      store.setGuides(snap.guides);

      const clampedX = Math.max(0, Math.min(snap.snapped.x, paperW - elW));
      const clampedY = Math.max(0, Math.min(snap.snapped.y, paperH - elH));
      store.moveElementMm(elementId, clampedX, clampedY);
    }

    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      store.clearGuides();
      dom!.classList.remove('is-pointer-active');
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

      const z = store.view.zoom;
      let dc = Math.round(dcPx / (cell.w * z));
      let dr = Math.round(drPx / (cell.h * z));

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

      // Iteration-3: enforce per-type minimum size in mm.
      const minMm = minMmFor(el!);
      const minCs = Math.max(1, Math.ceil((minMm.w * PX_PER_MM) / cell.w));
      const minRs = Math.max(1, Math.ceil((minMm.h * PX_PER_MM) / cell.h));
      if (newCs < minCs) {
        if (side.includes('w')) {
          // Dragging the west edge — pin the right edge so the element doesn't slide.
          newC = startC + startCs - minCs;
        }
        newCs = minCs;
      }
      if (newRs < minRs) {
        if (side.includes('n')) {
          newR = startR + startRs - minRs;
        }
        newRs = minRs;
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
