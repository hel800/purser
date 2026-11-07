<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import Logo from "./lib/Logo.svelte";
  import { initSettings, settings } from "./lib/settings.svelte";
  import { dateLanguage } from "./lib/parse";

  let recording = $state<"quick_add" | "list" | null>(null);
  let error = $state<string | null>(null);

  onMount(() => {
    const unlisteners: UnlistenFn[] = [];
    initSettings();
    listen<string>("purser://shortcut-error", (e) => {
      error = e.payload;
    }).then((fn) => unlisteners.push(fn));
    // recording must never survive losing focus — a keystroke meant for
    // another application could otherwise reassign the shortcut. The sheet
    // stays open (backend keeps it while capturing); explain what happened:
    // a combo owned by another app triggers that app and steals focus.
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && recording) {
          recording = null;
          invoke("end_capture");
          error =
            "Recording stopped — that combination seems to be in use by " +
            "another application (it just triggered there). Try a different one.";
        }
      })
      .then((fn) => unlisteners.push(fn));
    return () => unlisteners.forEach((fn) => fn());
  });

  function close() {
    if (recording) cancelRecording();
    invoke("close_help");
  }

  function startRecord(id: "quick_add" | "list") {
    error = null;
    recording = id;
    // release our own hotkeys so the combo lands in this webview
    invoke("begin_capture");
  }

  function cancelRecording() {
    recording = null;
    error = null;
    invoke("end_capture");
  }

  /** Combo token for a non-modifier key, or null for keys the shortcut
   *  parser does not understand. */
  function keyToken(code: string): string | null {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code.toLowerCase();
    const named: Record<string, string> = {
      Space: "space",
      Enter: "enter",
      Tab: "tab",
      Backspace: "backspace",
      Delete: "delete",
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Home: "home",
      End: "end",
      PageUp: "pageup",
      PageDown: "pagedown",
    };
    return named[code] ?? null;
  }

  /** The pressed combo, a reason it can't be used, or neither while only
   *  modifiers are down. */
  function comboFromEvent(e: KeyboardEvent): { combo?: string; reason?: string } {
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return {}; // wait for the main key
    const mods = [
      e.ctrlKey && "ctrl",
      e.altKey && "alt",
      e.shiftKey && "shift",
      e.metaKey && "super",
    ].filter(Boolean) as string[];
    if (mods.length === 0) {
      return { reason: "Hold down a modifier (Ctrl, Alt, Shift or Win) with a key." };
    }
    const token = keyToken(e.code);
    if (!token) return { reason: "Unsupported key — try a letter, number or F-key." };
    return { combo: [...mods, token].join("+") };
  }

  /** Wrap Tab between the sheet's focusable elements so focus never escapes
   *  the window (escaping would count as losing focus and close the sheet). */
  function cycleTab(e: KeyboardEvent) {
    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusables.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === focusables[0]) {
      e.preventDefault();
      focusables[focusables.length - 1].focus();
    } else if (!e.shiftKey && active === focusables[focusables.length - 1]) {
      e.preventDefault();
      focusables[0].focus();
    }
  }

  async function onKeydown(e: KeyboardEvent) {
    if (!recording) {
      if (e.key === "Escape") {
        close();
      } else if (e.key === "Tab") {
        cycleTab(e);
      }
      return;
    }
    e.preventDefault();
    if (e.repeat) return;
    if (e.key === "Escape") {
      cancelRecording();
      return;
    }
    const { combo, reason } = comboFromEvent(e);
    if (reason) {
      error = reason; // keep recording so another combo can be tried
      return;
    }
    if (!combo) return; // modifier only — the main key is still to come
    const id = recording;
    try {
      // set_shortcut re-registers both hotkeys itself on success
      await invoke("set_shortcut", { id, shortcut: combo });
      recording = null;
      error = null;
    } catch (err) {
      error = String(err); // keep recording so another combo can be tried
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main data-tauri-drag-region>
  <header data-tauri-drag-region>
    <Logo size={18} />
    <span class="title">Keyboard shortcuts</span>
    <button class="close" title="Close (Esc)" onclick={close}>✕</button>
  </header>

  <div class="sheet">
    <section>
      <h2>Global</h2>
      <div class="row global">
        <span class="keys">
          {#if recording === "quick_add"}
            <span class="rec-hint">Press a shortcut…</span>
          {:else}
            <kbd>{settings.quickAddPretty}</kbd>
          {/if}
          <button
            class="pen"
            class:cancel={recording === "quick_add"}
            title={recording === "quick_add" ? "Cancel recording (Esc)" : "Change shortcut"}
            onclick={() => (recording === "quick_add" ? cancelRecording() : startRecord("quick_add"))}
          >
            {recording === "quick_add" ? "✕" : "✎"}
          </button>
        </span>
        <span class="label">Quick-add popup</span>
      </div>
      <div class="row global">
        <span class="keys">
          {#if recording === "list"}
            <span class="rec-hint">Press a shortcut…</span>
          {:else}
            <kbd>{settings.listPretty}</kbd>
          {/if}
          <button
            class="pen"
            class:cancel={recording === "list"}
            title={recording === "list" ? "Cancel recording (Esc)" : "Change shortcut"}
            onclick={() => (recording === "list" ? cancelRecording() : startRecord("list"))}
          >
            {recording === "list" ? "✕" : "✎"}
          </button>
        </span>
        <span class="label">Todo list popup</span>
      </div>
      {#if error}<p class="error">{error}</p>{/if}
    </section>

    <section>
      <h2>Todo list</h2>
      <div class="row"><span class="keys"><kbd>↑</kbd> <kbd>↓</kbd> or <kbd>J</kbd> <kbd>K</kbd></span><span class="label">Navigate</span></div>
      <div class="row"><span class="keys"><kbd>Enter</kbd></span><span class="label">Mark selected as done</span></div>
      <div class="row"><span class="keys"><kbd>Tab</kbd></span><span class="label">Switch between Open and Done</span></div>
      <div class="row"><span class="keys"><kbd>E</kbd> or <kbd>F2</kbd></span><span class="label">Edit text</span></div>
      <div class="row"><span class="keys"><kbd>D</kbd></span><span class="label">Edit due date (empty removes it)</span></div>
      <div class="row"><span class="keys"><kbd>C</kbd></span><span class="label">Change category</span></div>
      <div class="row"><span class="keys"><kbd>Space</kbd></span><span class="label">Show / hide notes</span></div>
      <div class="row"><span class="keys"><kbd>N</kbd></span><span class="label">Edit notes (Ctrl+Enter saves)</span></div>
      <div class="row"><span class="keys"><kbd>T</kbd></span><span class="label">Cycle category filter</span></div>
      <div class="row"><span class="keys"><kbd>F</kbd></span><span class="label">Cycle due-date filter</span></div>
      <div class="row"><span class="keys"><kbd>Del</kbd></span><span class="label">Delete permanently (Done view)</span></div>
      <div class="row"><span class="keys"><kbd>L</kbd></span><span class="label">Full-size view, view only (<kbd>Ctrl+P</kbd> prints)</span></div>
      <div class="row"><span class="keys"><kbd>Esc</kbd></span><span class="label">Close popup</span></div>
    </section>

    <section>
      <h2>Quick-add</h2>
      <div class="row"><span class="keys"><kbd>Enter</kbd></span><span class="label">Save todo</span></div>
      <div class="row"><span class="keys"><kbd>Tab</kbd> or <kbd>→</kbd></span><span class="label">Accept category suggestion</span></div>
      <div class="row"><span class="keys"><kbd>//</kbd></span><span class="label">Everything after becomes a note</span></div>
      <div class="row"><span class="keys"><kbd>Ctrl+⌫</kbd></span><span class="label">Clear input</span></div>
      <div class="row"><span class="keys"><kbd>Esc</kbd></span><span class="label">Hide popup</span></div>
    </section>

    <section>
      <h2>Dates</h2>
      {#if dateLanguage() === "de"}
        <div class="row"><span class="keys"><kbd>Fr 15 Uhr</kbd></span><span class="label">Weekday and time</span></div>
        <div class="row"><span class="keys"><kbd>morgen</kbd> <kbd>in 2 Wochen</kbd></span><span class="label">Relative</span></div>
        <div class="row"><span class="keys"><kbd>Ende Oktober</kbd></span><span class="label">Also Anfang, Mitte</span></div>
        <div class="row"><span class="keys"><kbd>KW 44</kbd></span><span class="label">Monday of calendar week 44</span></div>
        <div class="row"><span class="keys"><kbd>23.12.</kbd></span><span class="label">23 December, the nearest one</span></div>
      {:else}
        <div class="row"><span class="keys"><kbd>friday 5pm</kbd></span><span class="label">Weekday and time</span></div>
        <div class="row"><span class="keys"><kbd>tomorrow</kbd> <kbd>in 2 weeks</kbd></span><span class="label">Relative</span></div>
        <div class="row"><span class="keys"><kbd>end of October</kbd></span><span class="label">Also early, mid</span></div>
      {/if}
      <div class="row"><span class="keys"><kbd>20261223</kbd></span><span class="label">Compact date</span></div>
      <p class="note">Language: tray → Settings → Date input</p>
    </section>

    <p class="tip">
      Dates and <kbd>#categories</kbd> parse as you type — try
      <span class="code">
        {dateLanguage() === "de" ? "Miete zahlen Fr 17 Uhr #finanzen" : "pay rent friday 5pm #finance"}
      </span>
    </p>
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    border: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.03em;
  }
  .close {
    margin-left: auto;
    background: none;
    border: none;
    padding: 2px 4px;
    font-size: 13px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .close:hover {
    color: var(--text);
  }
  .sheet {
    flex: 1;
    overflow-y: auto;
    padding: 8px 14px 12px;
    display: flex;
    flex-direction: column;
  }
  section {
    margin-top: 10px;
  }
  section:first-child {
    margin-top: 4px;
  }
  h2 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    margin-bottom: 4px;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 3px 0;
    font-size: 12px;
    color: var(--text);
  }
  .row.global {
    align-items: center;
  }
  .label {
    flex: 1;
  }
  .keys {
    flex: 0 0 auto;
    min-width: 120px;
    font-size: 11px;
    white-space: nowrap;
  }
  /* pencil next to the shortcut, as in the todo list; while recording the
     same slot holds the ✕ cancel, so the row never shifts */
  .pen {
    background: none;
    border: none;
    padding: 0;
    width: 16px;
    font-size: 12px;
    color: var(--text-dim);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0.45;
  }
  .row.global:hover .pen,
  .pen.cancel {
    opacity: 1;
  }
  .pen:hover {
    color: var(--accent);
    opacity: 1;
  }
  .pen.cancel:hover {
    color: var(--danger);
  }
  .rec-hint {
    /* same box metrics as a kbd (invisible borders included), so swapping
       between them never changes the row height */
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid transparent;
    border-bottom-width: 2px;
    font-size: 11px;
    color: var(--accent);
    white-space: nowrap;
  }
  .error {
    margin-top: 6px;
    font-size: 11px;
    color: var(--danger);
  }
  .note {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--text-dim);
  }
  .tip {
    margin-top: auto;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.5;
  }
  .tip .code {
    display: block;
    margin-top: 4px;
    font-family: "Cascadia Mono", Consolas, monospace;
    color: var(--ok);
  }
</style>