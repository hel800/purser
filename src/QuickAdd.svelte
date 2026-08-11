<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen, emit } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { parseTodo, formatDue } from "./lib/parse";
  import { addTodo } from "./lib/db";
  import { initSettings } from "./lib/settings.svelte";
  import Logo from "./lib/Logo.svelte";
  import wordmark from "./assets/purser-wordmark.svg";

  let value = $state("");
  let inputEl: HTMLInputElement;
  let parsed = $derived(parseTodo(value));

  const win = getCurrentWindow();

  onMount(() => {
    initSettings();
    inputEl.focus();
    const unlisten = listen("purser://focus", () => {
      // keep any half-typed todo; put the caret at its end
      inputEl.focus();
      inputEl.setSelectionRange(value.length, value.length);
    });
    return () => {
      unlisten.then((f) => f());
    };
  });

  async function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      await win.hide();
    } else if (e.key === "Backspace" && e.ctrlKey) {
      // default Ctrl+Backspace only deletes a word; clear everything
      e.preventDefault();
      value = "";
    } else if (e.key === "Enter" && parsed.text.length > 0) {
      await addTodo(parsed.text, parsed.topic, parsed.dueAt);
      value = "";
      await emit("purser://refresh");
      await win.hide();
    }
  }
</script>

<main>
  <div class="titlebar">
    <Logo size={18} />
    <span>Add new todo</span>
    <img class="wordmark" src={wordmark} alt="Purser" />
  </div>
  <!-- svelte-ignore a11y_autofocus -->
  <input
    bind:this={inputEl}
    bind:value
    onkeydown={onKeydown}
    placeholder="pay rent friday 5pm #finance"
    spellcheck="false"
    autofocus
  />
  <div class="hints">
    {#if parsed.dueAt}
      <span class="chip due">📅 {formatDue(parsed.dueAt)}</span>
    {/if}
    {#if parsed.topic}
      <span class="chip topic">#{parsed.topic}</span>
    {/if}
    <span class="muted">Enter save · Esc hide · Ctrl+⌫ clear</span>
  </div>
</main>

<style>
  main {
    padding: 10px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--border);
    height: 100vh;
  }
  .titlebar {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.03em;
  }
  .wordmark {
    margin-left: auto;
    height: 9px;
    opacity: 0.75;
  }
  input {
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 20px;
    width: 100%;
  }
  input::placeholder {
    color: var(--text-dim);
    opacity: 0.6;
  }
  .hints {
    display: flex;
    gap: 8px;
    min-height: 22px;
    align-items: center;
  }
  .chip {
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
    background: var(--bg-raised);
  }
  .chip.due {
    color: var(--accent);
  }
  .chip.topic {
    color: var(--ok);
  }
  .muted {
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
