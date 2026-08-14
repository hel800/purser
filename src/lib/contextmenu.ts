// The webview shows its own right-click menu (reload, inspect, …), which has
// nothing to do with the app. Swallow the event so the window stays inert on
// right-click — this also covers the keyboard route (Shift+F10 / menu key).
export function disableContextMenu(): void {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}
