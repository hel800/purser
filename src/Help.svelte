<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import Logo from "./lib/Logo.svelte";

  function close() {
    invoke("close_help");
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
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
      <div class="row"><span class="keys"><kbd>Ctrl+Alt+N</kbd></span>Quick-add popup</div>
      <div class="row"><span class="keys"><kbd>Ctrl+Alt+L</kbd></span>Todo list popup</div>
    </section>

    <section>
      <h2>Todo list</h2>
      <div class="row"><span class="keys"><kbd>↑</kbd> <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd></span>Navigate</div>
      <div class="row"><span class="keys"><kbd>Enter</kbd></span>Mark selected as done</div>
      <div class="row"><span class="keys"><kbd>Tab</kbd></span>Switch between Open and Done</div>
      <div class="row"><span class="keys"><kbd>E</kbd> or <kbd>F2</kbd></span>Edit text</div>
      <div class="row"><span class="keys"><kbd>D</kbd></span>Edit due date (empty removes it)</div>
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
  .keys {
    flex: 0 0 120px;
    min-width: 0;
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
  .tip {
    margin-top: 12px;
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