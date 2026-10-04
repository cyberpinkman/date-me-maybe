/* The playful button owns its movement. Hover never rerenders or submits the invitation. */
const RunawayButton = (() => {
  const lines = [
    "让我想想",
    "再想想嘛 🥺",
    "不要 / no",
    "不要啊 🙈",
    "点不到吧 😏",
    "差一点点～",
    "再追一下？",
    "我又跑啦～",
  ];
  const label = (count) =>
    count ? lines[1 + ((count - 1) % (lines.length - 1))] : lines[0];
  const gap = 12;
  const overlaps = (a, b) =>
    a.x < b.x + b.width + gap &&
    a.x + a.width > b.x - gap &&
    a.y < b.y + b.height + gap &&
    a.y + a.height > b.y - gap;
  function choose({ width, height, button, origin, pointer, avoid, turn = 0 }) {
    const maxX = Math.max(0, width - button.width - 5),
      maxY = Math.max(0, height - button.height - 5);
    const candidates = [],
      minX = avoid.x + avoid.width + gap;
    // A clear right-hand corridor also keeps the animated path away from "愿意".
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 9; col++) {
        const x = minX + ((maxX - minX) * col) / 8,
          y = (maxY * row) / 4,
          rect = { x, y, ...button };
        if (x < 0 || x > maxX) continue;
        if (overlaps(rect, avoid)) continue;
        const dx = Math.max(x - pointer.x, 0, pointer.x - x - button.width);
        const dy = Math.max(y - pointer.y, 0, pointer.y - y - button.height);
        const distance = Math.hypot(dx, dy),
          travel = Math.hypot(x - origin.x, y - origin.y);
        if (distance < 18 || travel < 32) continue;
        const variety = ((col * 7 + row * 11 + turn * 13) % 17) / 17;
        candidates.push({
          x,
          y,
          score: distance + travel * 0.3 + variety * 24,
        });
      }
    candidates.sort((a, b) => b.score - a.score);
    return (
      candidates[0] || {
        x: Math.min(maxX, Math.max(0, origin.x)),
        y: Math.min(maxY, Math.max(0, origin.y)),
      }
    );
  }
  function bind(area, state) {
    const button = area.querySelector(".tease-button"),
      slot = area.querySelector(".tease-slot"),
      yes = area.querySelector('[data-action="journey-yes"]');
    let lastMove = -Infinity,
      position = { x: 0, y: 0 },
      suppressPointerClick = false;
    function bounds() {
      const a = area.getBoundingClientRect(),
        s = slot.getBoundingClientRect(),
        b = button.getBoundingClientRect(),
        v = yes.getBoundingClientRect();
      return {
        width: a.width,
        height: a.height,
        button: { width: b.width, height: b.height },
        avoid: {
          x: v.left - a.left,
          y: v.top - a.top,
          width: v.width,
          height: v.height,
        },
        start: { x: s.left - a.left, y: s.top - a.top },
        area: a,
      };
    }
    function place(p) {
      position = { x: p.x, y: p.y };
      button.style.translate = `${p.x}px ${p.y}px`;
    }
    function fit() {
      const b = bounds(),
        maxX = Math.max(0, b.width - b.button.width - 5),
        maxY = Math.max(0, b.height - b.button.height - 5);
      let p = state.teasePosition
        ? { x: state.teasePosition.x * maxX, y: state.teasePosition.y * maxY }
        : b.start;
      if (state.teasePosition && overlaps({ ...p, ...b.button }, b.avoid))
        p = { x: maxX, y: maxY };
      button.style.transition = "none";
      place(p);
      // Flush only this button's position so resize/back navigation never plays a stray flight.
      button.getBoundingClientRect();
      button.style.transition = "";
    }
    function dodge(event) {
      const now = performance.now();
      if (now - lastMove < 180) return;
      const b = bounds();
      const keyboard = event?.type === "click" && event.detail === 0;
      const pointer =
        event && !keyboard && Number.isFinite(event.clientX)
          ? { x: event.clientX - b.area.left, y: event.clientY - b.area.top }
          : {
              x: position.x + b.button.width / 2,
              y: position.y + b.button.height / 2,
            };
      const next = choose({
        ...b,
        origin: position,
        pointer,
        turn: state.teaseCount,
      });
      state.teaseCount++;
      lastMove = now;
      button.textContent = label(state.teaseCount);
      button.dataset.dodges = String(state.teaseCount);
      place(next);
      state.teasePosition = {
        x: next.x / Math.max(1, b.width - b.button.width - 5),
        y: next.y / Math.max(1, b.height - b.button.height - 5),
      };
    }
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") dodge(event);
    });
    button.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch") dodge(event);
    });
    button.addEventListener("pointerdown", (event) => {
      suppressPointerClick = true;
      if (event.pointerType !== "mouse") event.preventDefault();
      dodge(event);
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if ((event.detail > 0 || event.pointerType) && suppressPointerClick) {
        suppressPointerClick = false;
        return;
      }
      dodge(event);
    });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    return () => observer.disconnect();
  }
  return { label, choose, bind };
})();
if (typeof module !== "undefined" && module.exports)
  module.exports = RunawayButton;
