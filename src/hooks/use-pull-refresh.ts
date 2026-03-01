import { useRef, useEffect, useCallback, useState } from "react";

interface UsePullRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;   // px to pull before triggering (default 80)
  maxPull?: number;     // max px the indicator can travel (default 120)
}

export function usePullRefresh({ onRefresh, threshold = 80, maxPull = 120 }: UsePullRefreshOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pulling = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 0 || refreshing) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, [refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current) return;
    currentY.current = e.touches[0].clientY;
    const delta = Math.max(0, currentY.current - startY.current);
    // Rubber-band effect: diminishing returns past threshold
    const dampened = delta > threshold
      ? threshold + (delta - threshold) * 0.3
      : delta;
    const clamped = Math.min(dampened, maxPull);
    setPullDistance(clamped);
    if (clamped > 0) e.preventDefault();
  }, [threshold, maxPull]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullDistance >= threshold && !refreshing) {
      setRefreshing(true);
      setPullDistance(threshold * 0.5); // hold at half during refresh
      try { await onRefresh(); } catch {}
      setRefreshing(false);
    }
    setPullDistance(0);
  }, [pullDistance, threshold, refreshing, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { containerRef, pullDistance, refreshing };
}
