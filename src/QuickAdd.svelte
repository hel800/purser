<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { LogicalSize } from "@tauri-apps/api/dpi";
  import { listen, emit } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { parseTodo, formatDue } from "./lib/parse";
  import { completeTag, tagAtCaret, tagGhost, tagSuggestions } from "./lib/quickadd";
  import { addTodo, listCategories, type Category } from "./lib/db";
  import { initSettings } from "./lib/settings.svelte";
  import { quickAddKeyAction } from "./lib/keys";
  import Logo from "./lib/Logo.svelte";
  import wordmark from "./assets/purser-wordmark.png";

  let value = $state("");
  let inputEl: HTMLTextAreaElement;
  let caret = $state(0);
  let categories = $state<Category[]>([]);
  let active = $state(0);
  let suppressSuggest = $state(false);
  let parsed = $derived(parseTodo(value));

  // Mirror the textarea's caret into state. Fired on input, clicks and
  // Home/End/arrow moves (selectionchange) — everything downstream (tag,
  // suggestions, ghost) derives from it.
  function syncCaret() {
    if (!inputEl) return;
    caret = inputEl.selectionStart ?? value.length;
  }

  // the input is a soft-wrapping textarea that grows with its content
  $effect(() => {
    void value;
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = `${inputEl.scrollHeight}px`;
  });

  // The `#tag` fragment currently being typed, anchored at the caret.
  let tag = $derived(suppressSuggest ? null : tagAtCaret(value, caret));

  let suggestions = $derived(tag ? tagSuggestions(categories, tag.partial) : []);

  // The grayed-out completion shown inline after the caret.
  let ghost = $derived(tagGhost(value, caret, tag, suggestions[active]));

  async function loadCategories() {
    categories = await listCategories();
  }

  function complete() {
    if (!tag) return;
    const pick = suggestions[active];
    if (!pick) return;
    const completed = completeTag(value, caret, tag, pick.name);
    value = completed.value;
    const pos = completed.caret;
    queueMicrotask(() => {
      inputEl.focus();
      inputEl.setSelectionRange(pos, pos);
    });
    caret = pos;
    // stop suggesting right after a completion
    suppressSuggest = true;
  }

  const win = getCurrentWindow();

  let hintsEl: HTMLElement;

  // The quick-add popup is a fixed-width 620px window. The titlebar and
  // paddings have constant height, but both the (wrapping) input and the
  // hints row can grow onto extra lines — the window must grow with them
  // and shrink back once everything fits a single line again.
  const BASE_HEIGHT = 108;
  const HINTS_BASE = 22;
  const INPUT_BASE = 26; // one 20px/1.3 line
  let fitRaf = 0;
  function fitWindow() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
      if (!hintsEl) return;
      const hintsHeight = Math.max(HINTS_BASE, hintsEl.offsetHeight);
      const inputHeight = Math.max(INPUT_BASE, inputEl?.offsetHeight ?? INPUT_BASE);
      win.setSize(
        new LogicalSize(620, BASE_HEIGHT + (hintsHeight - HINTS_BASE) + (inputHeight - INPUT_BASE))
      );
    });
  }

  onMount(() => {
    initSettings();
    loadCategories();
    inputEl.focus();
    document.addEventListener("selectionchange", syncCaret);
    const resizeObserver = new ResizeObserver(() => fitWindow());
    resizeObserver.observe(hintsEl);
    resizeObserver.observe(inputEl);
    const unlisten = listen("purser://focus", () => {
      loadCategories();
      // keep any half-typed todo; put the caret at its end
      inputEl.focus();
      inputEl.setSelectionRange(value.length, value.length);
      syncCaret();
    });
    return () => {
      document.removeEventListener("selectionchange", syncCaret);
      resizeObserver.disconnect();
      unlisten.then((f) => f());
    };
  });

  function onInput() {
    syncCaret();
    active = 0;
    suppressSuggest = false;
  }

  async function onKeydown(e: KeyboardEvent) {
    const { action, preventDefault } = quickAddKeyAction(e.key, e.ctrlKey, ghost !== "");
    if (preventDefault) e.preventDefault();
    switch (action) {
      case "help":
        invoke("open_help");
        break;
      case "complete":
        complete();
        break;
      case "nextSuggestion":
        active = Math.min(active + 1, suggestions.length - 1);
        break;
      case "previousSuggestion":
        active = Math.max(active - 1, 0);
        break;
      case "hide":
        await win.hide();
        break;
      case "clear":
        value = "";
        break;
      case "save":
        if (parsed.text.length === 0) return;
        await addTodo(parsed.text, parsed.category, parsed.dueAt, parsed.notes);
        value = "";
        await emit("purser://refresh");
        await win.hide();
        break;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main>
  <div class="titlebar">
    <Logo size={18} />
    <span>Add new todo</span>
    <button class="small-btn" title="Keyboard shortcuts (? / F1)" onclick={() => invoke("open_help")}>?</button>
    <img class="wordmark" src={wordmark} alt="Purser" width="60" height="9" />
  </div>
  <div class="qawrap">
    <textarea
      bind:this={inputEl}
      bind:value
      oninput={onInput}
      rows="1"
      placeholder="pay rent friday 5pm #finance"
      spellcheck="false"
    ></textarea>
    <span class="ghost" aria-hidden="true">
      <span class="ghost-typed">{value}</span>{#if ghost}<span class="ghost-suffix">{ghost}</span>{/if}
    </span>
  </div>
  <div class="hints" bind:this={hintsEl}>
    {#if parsed.dueAt}
      <!-- a date that is already over as it is typed is most likely a typo:
           warn in the chip, but Enter still saves it (no dialog, no extra key) -->
      <span class="chip due" class:past={parsed.duePast} title={parsed.duePast ? "This date is already in the past" : undefined}>{parsed.duePast ? "⚠" : "📅"} {formatDue(parsed.dueAt)}{#if parsed.duePast} · in the past{/if}</span>
    {/if}
    {#if parsed.category}
      <span class="chip category">#{parsed.category}</span>
    {/if}
    {#if parsed.notes}
      <span class="chip note">📝 note</span>
    {/if}
    <span class="muted hints">
      <span class="hint"><kbd>Enter</kbd> save</span>
      <span class="hint"><kbd>Tab</kbd> complete</span>
      <span class="hint"><kbd>//</kbd> note</span>
      <span class="hint"><kbd>Esc</kbd> hide</span>
      <span class="hint"><kbd>Ctrl+⌫</kbd> clear</span>
    </span>
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
    height: 9px;
    opacity: 0.75;
  }
  .small-btn {
    margin-left: auto;
  }
  textarea {
    display: block;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    overflow: hidden; /* height is fitted to the content, never scrolls */
    color: transparent;
    caret-color: var(--text);
    /* must render with exactly the same metrics and wrapping as the ghost */
    font-family: inherit;
    font-size: 20px;
    line-height: 1.3;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    width: 100%;
    padding: 0;
    position: relative;
    z-index: 1;
  }
  textarea::placeholder {
    color: var(--text-dim);
    opacity: 0.6;
  }
  .qawrap {
    position: relative;
  }
  .ghost {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    font-family: inherit;
    font-size: 20px;
    line-height: 1.3;
    /* pre-wrap: wraps exactly like the textarea, spaces keep their width */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    pointer-events: none;
    color: var(--text-dim);
    opacity: 0.6;
    z-index: 0;
  }
  .ghost-typed {
    color: var(--text);
  }
  .ghost-suffix {
    color: var(--text-dim);
    opacity: 0.6;
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 22px;
    align-items: center;
  }
  .chip {
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
    background: var(--bg-raised);
    max-width: 100%;
    /* keep long unbreakable #tags from spilling past the window edge */
    overflow-wrap: anywhere;
  }
  .chip.due {
    color: var(--accent);
  }
  /* same red as an overdue todo in the list — that is what it would become */
  .chip.due.past {
    color: var(--danger);
  }
  .chip.category {
    color: var(--ok);
  }
  .chip.note {
    color: var(--warn);
  }
  .muted {
    color: var(--text-dim);
    font-size: 12px;
    min-width: 0;
  }
  .hints {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: center;
  }
  kbd {
    /* the thicker bottom border shifts the key's text upward; drop the
       keycap 3px so it lines up with the hint description text */
    margin-top: 3px;
  }
</style>
