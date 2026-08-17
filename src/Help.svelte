<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import Logo from "./lib/Logo.svelte";
  import { initSettings, settings, prettyShortcut } from "./lib/settings.svelte";

  interface Captured {
    id: string;
    shortcut: string | null;
    cancelled: boolean;
    reason: string | null;
  }

  let recording: "quick_add" | "list" | null = null;
  let error: string | null = null;
  let unlisten: UnlistenFn | null = null;

  onMount(() => {
    initSettings();
    listen<Captured>("purser://shortcut-captured", (e) => {
      if (e.payload.id !== recording) return;
      if (e.payload.cancelled) {
        cancelRecording();
        return;
      }
      if (e.payload.reason) {
        error = e.payload.reason;
        invoke("set_recording", { id: recording });
        return;
      }
      const id = recording;
      invoke("set_shortcut", { id, shortcut: e.payload.shortcut })
        .then(() => {
          recording = null;
          error = null;
          invoke("set_recording", { id: null });
        })
        .catch((err) => {
          error = String(err);
          invoke("set_recording", { id: recording });
        });
    }).then((fn) => {
      unlisten = fn;
    });
  });

  function close() {
    invoke("close_help");
  }

  onDestroy(() => {
    unlisten?.();
  });

  function onKeydown(e: KeyboardEvent) {
    // while recording, the OS-level listener in the backend drives capture
    if (recording) return;
    if (e.key === "Escape") close();
  }

  function startRecord(id: "quick_add" | "list") {
    error = null;
    recording = id;
    invoke("set_recording", { id });
  }

  function cancelRecording() {
    recording = null;
    error = null;
    invoke("set_recording", { id: null });
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
        <span class="keys"><kbd>{prettyShortcut(settings.quickAddShortcut)}</kbd></span>
        <span class="label">Quick-add popup</span>
        <button
          class="record"
          class:active={recording === "quick_add"}
          onclick={() => startRecord("quick_add")}
        >
          {recording === "quick_add" ? "Press a shortcut…" : "Change"}
        </button>
      </div>
      <div class="row global">
        <span class="keys"><kbd>{prettyShortcut(settings.listShortcut)}</kbd></span>
        <span class="label">Todo list popup</span>
        <button
          class="record"
          class:active={recording === "list"}
          onclick={() => startRecord("list")}
        >
          {recording === "list" ? "Press a shortcut…" : "Change"}
        </button>
      </div>
      {#if error}<p class="error">{error}</p>{/if}
    </section>

    <section>
      <h2>Todo list</h2>
      <div class="row"><span class="keys"><kbd>↑</kbd> <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd></span>Navigate</div>
      <div class="row"><span class="keys"><kbd>Enter</kbd></span>Mark selected as done</div>
      <div class="row"><span class="keys"><kbd>Tab</kbd></span>Switch between Open and Done</div>
      <div class="row"><span class="keys"><kbd>E</kbd> or <kbd>F2</kbd></span>Edit text</div>
      <div class="row"><span class="keys"><kbd>D</kbd></span>Edit due date (empty removes it)</div>
      <div class="row"><span class="keys"><kbd>C</kbd></span>Change category</div>
      <div class="row"><span class="keys"><kbd>Del</kbd></span>Delete permanently (Done view)</div>
      <div class="row"><span class="keys"><kbd>Esc</kbd></span>Close popup</div>
    </section>

    <section>
      <h2>Quick-add</h2>
      <div class="row"><span class="keys"><kbd>Enter</kbd></span>Save todo</div>
      <div class="row"><span class="keys"><kbd>Tab</kbd> or <kbd>→</kbd></span>Accept category suggestion</div>
      <div class="row"><span class="keys"><kbd>Ctrl+⌫</kbd></span>Clear input</div>
      <div class="row"><span class="keys"><kbd>Esc</kbd></span>Hide popup</div>
    </section>

    <p class="tip">
      Dates and <kbd>#categories</kbd> parse as you type — try
      <span class="code">pay rent friday 5pm #finance</span>
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
  kbd {
    display: inline-block;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 1px 5px;
    font-family: inherit;
    font-size: 11px;
    color: var(--text);
    white-space: nowrap;
  }
  .record {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 8px;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .record:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .record.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .error {
    margin-top: 6px;
    font-size: 11px;
    color: var(--danger);
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