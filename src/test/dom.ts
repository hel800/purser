// Setup for the `dom` project only.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/svelte";

// unmount before setup.ts clears the IPC mock (after-hooks run last-
// registered first): unmounting unlistens, which still goes through IPC
afterEach(cleanup);

// Browser APIs the components use that jsdom doesn't implement:

// Svelte transitions run on the Web Animations API: finish every animation
// right away (a microtask, so fake timers don't hold transitions back)
Element.prototype.animate = function () {
  const animation = {
    onfinish: null as (() => void) | null,
    playState: "finished",
    currentTime: 0,
    effect: null,
    cancel() {},
  };
  queueMicrotask(() => animation.onfinish?.());
  return animation as unknown as Animation;
};

Element.prototype.scrollIntoView = function () {};
Element.prototype.scrollTo = function () {};
Element.prototype.scrollBy = function () {};

// like the real one, reports every observed element once right away
globalThis.ResizeObserver ??= class {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    queueMicrotask(() => this.callback([], this as unknown as ResizeObserver));
  }
  unobserve() {}
  disconnect() {}
};

// jsdom only logs "not implemented"; the print flow just needs it to return
window.print = () => {};
