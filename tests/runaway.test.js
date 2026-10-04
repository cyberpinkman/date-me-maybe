const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/runaway.js");

test("every chase keeps the button in the play area and clear of the fixed yes button", () => {
  for (const width of [230, 294, 372, 430]) {
    const button = { width: width * 0.42, height: 47 };
    const avoid = { x: 0, y: 0, width: width * 0.42, height: 47 };
    let origin = { x: width * 0.5, y: 0 };
    for (let turn = 0; turn < 40; turn++) {
      const pointer = {
        x: origin.x + button.width / 2,
        y: origin.y + button.height / 2,
      };
      const next = R.choose({
        width,
        height: 128,
        button,
        origin,
        pointer,
        avoid,
        turn,
      });
      assert.ok(next.x >= 0 && next.y >= 0);
      assert.ok(
        next.x + button.width <= width && next.y + button.height <= 128,
      );
      assert.ok(
        next.x >= avoid.width + 12,
        "both endpoints and the straight path stay to the right of yes",
      );
      assert.ok(
        Math.hypot(next.x - origin.x, next.y - origin.y) >= 32,
        "each chase actually changes the position",
      );
      assert.ok(
        pointer.x < next.x ||
          pointer.x > next.x + button.width ||
          pointer.y < next.y ||
          pointer.y > next.y + button.height,
        "the pointer is left outside the moved button",
      );
      origin = next;
    }
  }
});

test("each successive chase changes its line and the playful loop does not terminate", () => {
  assert.equal(R.label(0), "让我想想");
  const lines = new Set();
  for (let n = 1; n < 40; n++) {
    assert.notEqual(R.label(n), R.label(n - 1));
    lines.add(R.label(n));
  }
  assert.ok(lines.size >= 4);
});

test("binding counts each touch gesture once, keeps chasing the mouse, and disconnects on cleanup", () => {
  const originals = {
    performance: Object.getOwnPropertyDescriptor(globalThis, "performance"),
    ResizeObserver: Object.getOwnPropertyDescriptor(
      globalThis,
      "ResizeObserver",
    ),
  };
  let now = 1000,
    observer;
  const handlers = {},
    state = { teaseCount: 0, teasePosition: null };
  const button = {
    style: {},
    dataset: {},
    textContent: R.label(0),
    getBoundingClientRect: () => ({ width: 123.48, height: 47 }),
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
  };
  const yesRect = { left: 100, top: 200, width: 123.48, height: 47 };
  const area = {
    getBoundingClientRect: () => ({
      left: 100,
      top: 200,
      width: 294,
      height: 128,
    }),
    querySelector: (selector) =>
      selector === ".tease-button"
        ? button
        : selector === ".tease-slot"
          ? { getBoundingClientRect: () => ({ left: 247, top: 200 }) }
          : { getBoundingClientRect: () => yesRect },
  };
  function dispatch(type, pointerType, detail = 0) {
    const [x, y] = button.style.translate.split(" ").map(parseFloat);
    handlers[type]({
      type,
      pointerType,
      detail,
      clientX: 100 + x + 123.48 / 2,
      clientY: 200 + y + 47 / 2,
      preventDefault() {},
    });
  }
  try {
    Object.defineProperty(globalThis, "performance", {
      configurable: true,
      value: { now: () => now },
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        constructor(callback) {
          this.callback = callback;
          this.disconnected = false;
          observer = this;
        }
        observe(target) {
          this.target = target;
        }
        disconnect() {
          this.disconnected = true;
        }
      },
    });
    const cleanup = R.bind(area, state);
    assert.equal(observer.target, area);

    for (let gesture = 1; gesture <= 2; gesture++) {
      dispatch("pointerdown", "touch");
      assert.equal(state.teaseCount, gesture);
      now += 450;
      dispatch("click", "touch", 1);
      assert.equal(
        state.teaseCount,
        gesture,
        "a delayed click from the same touch does not cause a second dodge",
      );
      now += 250;
    }

    for (let chase = 3; chase <= 10; chase++) {
      const previousPosition = button.style.translate,
        previousLabel = button.textContent;
      dispatch("pointerenter", "mouse");
      assert.equal(state.teaseCount, chase);
      assert.notEqual(button.style.translate, previousPosition);
      assert.notEqual(button.textContent, previousLabel);
      assert.deepEqual(yesRect, {
        left: 100,
        top: 200,
        width: 123.48,
        height: 47,
      });
      now += 250;
    }
    cleanup();
    assert.equal(observer.disconnected, true);
  } finally {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
