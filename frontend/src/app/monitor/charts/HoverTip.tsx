import { useCallback, useState, type ReactNode } from 'react';

/** A per-mark tooltip for HTML marks (table cells, bars): follows the pointer, and also opens on
 *  keyboard focus so it is not mouse-only. `bind(content)` goes on each mark. */
export function useHoverTip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const bind = useCallback((content: ReactNode) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: r.right, y: r.bottom, content }); },
    onBlur: () => setTip(null),
  }), []);
  const node = tip && (
    <div className="chart-tip" role="tooltip" style={{ position: 'fixed', left: Math.min(tip.x + 14, window.innerWidth - 300), top: tip.y + 14, maxWidth: 290 }}>{tip.content}</div>
  );
  return { bind, node };
}
