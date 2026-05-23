import { useDesignerStore } from '../stores/designer';

import { minMmFor } from './elementFactory';
import { computeSnap, SNAP_THRESHOLD_MM, GUIDE_THRESHOLD_MM } from './snapGuides';

const PX_PER_MM = 4;

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

  function getElement() {
    return store.template.elements.find((e) => e.id === elementId);
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
        guideThreshold: ev.altKey ? 0 : GUIDE_THRESHOLD_MM,
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
    const startX = e.clientX;
    const startY = e.clientY;
    const startAnchor = { ...el.anchor };
    const mode = getResizeMode();
    const minMm = minMmFor(el);
    const paperW = store.paperPx.w / PX_PER_MM;
    const paperH = store.paperPx.h / PX_PER_MM;

    store.isResizing = true;

    function onMove(ev: PointerEvent): void {
      let dxMm = (ev.clientX - startX) / (PX_PER_MM * store.view.zoom);
      let dyMm = (ev.clientY - startY) / (PX_PER_MM * store.view.zoom);

      // QR 1:1 lock — sync axes
      if (mode === 'qr-lock') {
        const basis = Math.max(Math.abs(dxMm), Math.abs(dyMm));
        dxMm = (dxMm >= 0 ? 1 : -1) * basis;
        dyMm = (dyMm >= 0 ? 1 : -1) * basis;
      }

      let { x, y, w, h } = startAnchor;

      if (side.includes('w')) {
        const newX = startAnchor.x + dxMm;
        const newW = startAnchor.w - dxMm;
        if (newW >= minMm.w) {
          x = newX;
          w = newW;
        } else {
          x = startAnchor.x + startAnchor.w - minMm.w;
          w = minMm.w;
        }
      } else if (side.includes('e')) {
        w = Math.max(minMm.w, startAnchor.w + dxMm);
      }
      if (side.includes('n')) {
        const newY = startAnchor.y + dyMm;
        const newH = startAnchor.h - dyMm;
        if (newH >= minMm.h) {
          y = newY;
          h = newH;
        } else {
          y = startAnchor.y + startAnchor.h - minMm.h;
          h = minMm.h;
        }
      } else if (side.includes('s')) {
        h = Math.max(minMm.h, startAnchor.h + dyMm);
      }

      // QR strict w === h (use smaller)
      if (mode === 'qr-lock') {
        const m = Math.min(w, h);
        w = m;
        h = m;
      }

      // 1D barcode min height 0.5 mm
      if (mode === 'barcode' && h < 0.5) {
        if (side.includes('n')) {
          y = startAnchor.y + startAnchor.h - 0.5;
        }
        h = 0.5;
      }

      // clamp to paper
      if (x < 0) {
        w += x;
        x = 0;
      }
      if (y < 0) {
        h += y;
        y = 0;
      }
      if (x + w > paperW) w = paperW - x;
      if (y + h > paperH) h = paperH - y;

      // Final safety net: prevent zero/negative dimensions from any combination of clamps above
      w = Math.max(minMm.w, w);
      h = Math.max(minMm.h, h);

      store.resizeElementMm(elementId, { x, y, w, h });
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
