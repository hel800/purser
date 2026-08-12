<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen, emit } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { parseTodo, formatDue } from "./lib/parse";
  import { addTodo, listCategories, type Category } from "./lib/db";
  import { initSettings } from "./lib/settings.svelte";
  import Logo from "./lib/Logo.svelte";
  import wordmark from "./assets/purser-wordmark.png";

  let value = $state("");
  let inputEl: HTMLInputElement;
  let caret = $state(0);
  let scrollLeft = $state(0);
  let categories = $state<Category[]>([]);
  let active = $state(0);
  let suppressSuggest = $state(false);
  let parsed = $derived(parseTodo(value));

  // Mirror the input's caret and horizontal scroll into state. Fired on
  // input, clicks, Home/End/arrow moves (selectionchange) and scrolling —
  // everything downstream (tag, suggestions, ghost) derives from these.
  function syncCaret() {
    if (!inputEl) return;
    caret = inputEl.selectionStart ?? value.length;
    scrollLeft = inputEl.scrollLeft;
  }

  // The `#tag` fragment currently being typed, anchored at the caret.
  let tag = $derived.by(() => {
    if (suppressSuggest) return null;
    const before = value.slice(0, caret);
    const hash = before.lastIndexOf("#");
    if (hash === -1) return null;
    const partial = before.slice(hash + 1);
    if (!/^[\p{L}\p{N}_-]*$/u.test(partial)) return null;
    return { start: hash, partial };
  });

  let suggestions = $derived.by(() => {
    if (!tag || !tag.partial) return [];
    const p = tag.partial.toLowerCase();
    // an exact match needs no completion — offering it would make the keys
    // below intercept navigation while nothing visible is suggested
    return categories
      .filter((c) => c.name.toLowerCase().startsWith(p) && c.name.toLowerCase() !== p)
      .slice(0, 6);
  });

  // The grayed-out completion shown inline after the caret.
  let ghost = $derived.by(() => {
    if (!tag || !tag.partial) return "";
    // only when the caret sits at the very end of the line
    if (value.slice(caret).trim() !== "") return "";
    const pick = suggestions[active];
    if (!pick) return "";
    return pick.name.slice(tag.partial.length);
  });

  async function loadCategories() {
    categories = await listCategories();
  }

  function complete() {
    if (!tag) return;
    const pick = suggestions[active];
    if (!pick) return;
    // keep the leading # that starts the tag
    value = value.slice(0, tag.start + 1) + pick.name + value.slice(caret);
    const pos = tag.start + 1 + pick.name.length;
    queueMicrotask(() => {
      inputEl.focus();
      inputEl.setSelectionRange(pos, pos);
    });
    caret = pos;
    // stop suggesting right after a completion
    suppressSuggest = true;
  }

  const win = getCurrentWindow();

  onMount(() => {
    initSettings();
    loadCategories();
    inputEl.focus();
    document.addEventListener("selectionchange", syncCaret);
    const unlisten = listen("purser://focus", () => {
      loadCategories();
      // keep any half-typed todo; put the caret at its end
      inputEl.focus();
      inputEl.setSelectionRange(value.length, value.length);
      syncCaret();
    });
    return () => {
      document.removeEventListener("selectionchange", syncCaret);
      unlisten.then((f) => f());
    };
  });

  function onInput() {
    syncCaret();
    active = 0;
    suppressSuggest = false;
  }

  async function onKeydown(e: KeyboardEvent) {
    // only intercept keys while a completion is actually visible
    if (ghost) {
      if (e.key === "Tab" || e.key === "ArrowRight") {
        e.preventDefault();
        complete();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = (active + 1) % suggestions.length;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        active = (active - 1 + suggestions.length) % suggestions.length;
        return;
      }
    }
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
    <img class="wordmark" src={wordmark} alt="Purser" width="60" height="9" />
  </div>
  <!-- svelte-ignore a11y_autofocus -->
  <div class="qawrap">
    <input
      bind:this={inputEl}
      bind:value
      oninput={onInput}
      onkeydown={onKeydown}
      onscroll={syncCaret}
      placeholder="pay rent friday 5pm #finance"
      spellcheck="false"
      autofocus
    />
    <span class="ghost" aria-hidden="true" style="transform: translateX({-scrollLeft}px)">
      <span class="ghost-typed">{value}</span>{#if ghost}<span class="ghost-suffix">{ghost}</span>{/if}
    </span>
  </div>
  <div class="hints">
    {#if parsed.dueAt}
      <span class="chip due">📅 {formatDue(parsed.dueAt)}</span>
    {/if}
    {#if parsed.topic}
      <span class="chip topic">#{parsed.topic}</span>
    {/if}
    <span class="muted">Enter save · Tab complete · Esc hide · Ctrl+⌫ clear</span>
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
    color: transparent;
    caret-color: var(--text);
    /* must render with exactly the same metrics as the ghost overlay */
    font-family: inherit;
    font-size: 20px;
    line-height: 1.15;
    width: 100%;
    padding: 0;
    position: relative;
    z-index: 1;
  }
  input::placeholder {
    color: var(--text-dim);
    opacity: 0.6;
  }
  .qawrap {
    position: relative;
    /* clip the ghost when it is shifted left to follow the input's scroll */
    overflow: hidden;
  }
  .ghost {
    position: absolute;
    left: 0;
    top: 0;
    font-family: inherit;
    font-size: 20px;
    line-height: 1.15;
    /* pre, not nowrap: consecutive spaces must occupy the same width as in the input */
    white-space: pre;
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
