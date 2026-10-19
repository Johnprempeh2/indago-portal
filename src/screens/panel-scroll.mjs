// After a tab change, how far to scroll so the new panel's heading sits fully
// below the sticky tab bar. Returns the scroll delta in px, or 0 when the
// heading is already in view (the bar is not stuck, or the panel starts below it).
// `navTop`/`navBottom`/`panelTop` are viewport px from getBoundingClientRect;
// `gap` is the bar's bottom margin, so the panel lands where it sits in normal flow.
export function panelScrollDelta({ navTop, navBottom, panelTop, gap }) {
  if (navTop > 0.5) return 0;
  const target = navBottom + gap;
  return panelTop < target ? Math.round(panelTop - target) : 0;
}
