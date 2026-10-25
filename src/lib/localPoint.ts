/**
 * A pointer position in an element's own, untransformed coordinates.
 *
 * `getBoundingClientRect()` is the axis-aligned box around an element after
 * every CSS transform on it and its ancestors, so under a rotation it is
 * bigger than the element and its axes are not the element's. This undoes
 * the accumulated rotation and scale instead: it multiplies the 2×2 linear
 * part of each computed transform up the tree, then maps the point back
 * around the element's centre (which the bounding box's centre always is).
 */
export function localPoint(el: HTMLElement, clientX: number, clientY: number) {
  let a = 1, b = 0, c = 0, d = 1;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const t = getComputedStyle(n).transform;
    if (!t || t === 'none') continue;
    const m = new DOMMatrixReadOnly(t);
    // Ancestor transforms apply after (outside) the ones nearer the element.
    [a, b, c, d] = [m.a * a + m.c * b, m.b * a + m.d * b, m.a * c + m.c * d, m.b * c + m.d * d];
  }
  const r = el.getBoundingClientRect();
  const dx = clientX - (r.left + r.width / 2);
  const dy = clientY - (r.top + r.height / 2);
  const det = a * d - b * c || 1;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  return {
    x: (d * dx - c * dy) / det + w / 2,
    y: (-b * dx + a * dy) / det + h / 2,
    width: w,
    height: h,
  };
}
