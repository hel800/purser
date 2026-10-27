// jsdom has no ResizeObserver. This one reports every observed element once
// right away, like the real one, and again on `triggerResize()`: jsdom has
// no layout, so a test changes an element's size itself and then says so.

const observers = new Set<StubResizeObserver>();

class StubResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    observers.add(this);
    queueMicrotask(() => this.notify());
  }
  unobserve() {}
  disconnect() {
    observers.delete(this);
  }
  notify() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

export function installResizeObserver() {
  globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;
}

/** Reports a size change to every connected observer. */
export function triggerResize() {
  for (const observer of observers) observer.notify();
}
