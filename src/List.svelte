<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { openTodos, doneTodos, type Todo } from "./lib/db";
  import { formatDue, dueStatus, linkify } from "./lib/parse";
  import {
    DUE_LABELS,
    categoryInfo,
    filterTodos,
    groupByCategory,
    nextCategory,
    nextDue,
    type CategoryFilter,
    type DueFilter,
    type Group,
    type ViewState,
  } from "./lib/filters";
  import { initSettings } from "./lib/settings.svelte";
  import FilterBar from "./lib/FilterBar.svelte";
  import Logo from "./lib/Logo.svelte";
  import wordmark from "./assets/purser-wordmark.png";

  // The full-size view is the popup's list blown up to the whole screen, and
  // view-only: it shows everything the popup can't fit and prints it. Nothing
  // in this window writes to the database; L or Esc goes back to the popup.

  type View = "open" | "done";

  const ROW_SCROLL = 40; // px per arrow key press, about one todo row

  let view: View = $state("open");
  let todos: Todo[] = $state([]);
  let catFilter: CategoryFilter = $state(null);
  let dueFilter: DueFilter = $state("all");
  let filterMenu: "cat" | "due" | null = $state(null);
  let listEl = $state<HTMLElement>();
  let printedAt = $state(new Date());

  // filters narrow the Open view only; Done always shows everything (as in the popup)
  let groups: Group[] = $derived.by(() => {
    if (view === "done") return todos.length ? [{ id: null, topic: "Done", color: null, todos }] : [];
    return groupByCategory(filterTodos(todos, catFilter, dueFilter));
  });

  let isEmpty = $derived(groups.length === 0);

  /** "Open · #work · This week" — what the printout shows, as its heading. */
  let viewTitle = $derived.by(() => {
    if (view === "done") return "Done";
    const parts = ["Open"];
    if (catFilter !== null) {
      const label = categoryInfo(todos, catFilter).label;
      parts.push(catFilter === -1 ? label : `#${label}`);
    }
    if (dueFilter !== "all") parts.push(DUE_LABELS[dueFilter]);
    return parts.join(" · ");
  });

  const win = getCurrentWindow();

  async function reload() {
    todos = view === "open" ? await openTodos() : await doneTodos();
  }

  /** Back to the small popup, which takes over view and filters. */
  function backToPopup() {
    filterMenu = null;
    const state: ViewState = { view, catFilter, dueFilter };
    invoke("close_list", { state });
  }

  function openHelp() {
    invoke("open_help");
  }

  async function switchView(v: View) {
    if (view === v) return;
    // fetch first, then commit view + data together (no intermediate render)
    const data = v === "open" ? await openTodos() : await doneTodos();
    view = v;
    todos = data;
    filterMenu = null;
    listEl?.scrollTo({ top: 0 });
  }

  function print() {
    filterMenu = null;
    printedAt = new Date();
    window.print();
  }

  function scrollList(by: number) {
    listEl?.scrollBy({ top: by });
  }

  onMount(() => {
    initSettings();
    reload();
    // edits in the popup or quick-add show up right away; the focus reload
    // also refreshes overdue/soon highlighting after time has passed
    const unlistenChanged = listen("purser://todos-changed", reload);
    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
      if (focused) reload();
    });
    // sent before the window shows: the popup's view and filters, or null
    // (opened from the tray) for a fresh Open view
    const unlistenState = listen<ViewState | null>("purser://list-state", async (e) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      const state: ViewState = e.payload ?? { view: "open", catFilter: null, dueFilter: "all" };
      const data = state.view === "open" ? await openTodos() : await doneTodos();
      view = state.view;
      todos = data;
      catFilter = state.catFilter;
      dueFilter = state.dueFilter;
      filterMenu = null;
      listEl?.scrollTo({ top: 0 });
    });
    return () => {
      unlistenChanged.then((f) => f());
      unlistenFocus.then((f) => f());
      unlistenState.then((f) => f());
    };
  });

  async function onKeydown(e: KeyboardEvent) {
    // bound explicitly: the webview's own Ctrl+P is not reliable everywhere
    if (e.ctrlKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      print();
      return;
    }
    // leave other modifier combos (Ctrl+C on selected text…) to the webview
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (filterMenu) {
      // any key closes the dropdown; T/F etc. still do their job below
      filterMenu = null;
      if (e.key === "Escape") return;
    }
    const page = (listEl?.clientHeight ?? 400) - ROW_SCROLL;
    switch (e.key) {
      case "Escape":
      case "l":
        e.preventDefault();
        backToPopup();
        break;
      case "ArrowDown":
      case "j":
        e.preventDefault();
        scrollList(ROW_SCROLL);
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        scrollList(-ROW_SCROLL);
        break;
      case "PageDown":
        e.preventDefault();
        scrollList(page);
        break;
      case "PageUp":
        e.preventDefault();
        scrollList(-page);
        break;
      case " ":
        // also blocks a focused button from being space-activated
        e.preventDefault();
        scrollList(e.shiftKey ? -page : page);
        break;
      case "Home":
        e.preventDefault();
        listEl?.scrollTo({ top: 0 });
        break;
      case "End":
        e.preventDefault();
        listEl?.scrollTo({ top: listEl.scrollHeight });
        break;
      case "Tab":
        e.preventDefault();
        await switchView(view === "open" ? "done" : "open");
        break;
      case "t":
        if (view === "open") {
          e.preventDefault();
          catFilter = nextCategory(todos, catFilter);
        }
        break;
      case "f":
        if (view === "open") {
          e.preventDefault();
          dueFilter = nextDue(dueFilter);
        }
        break;
      case "Enter":
        // a previously clicked button may still hold focus — don't re-click it
        e.preventDefault();
        break;
      case "?":
      case "F1":
        e.preventDefault();
        openHelp();
        break;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main>
  <header>
    <Logo size={20} />
    <button class="tab" class:active={view === "open"} onclick={() => switchView("open")}>
      Open
    </button>
    <button class="tab" class:active={view === "done"} onclick={() => switchView("done")}>
      Done
    </button>
    <button
      class="view-only"
      title="Nothing can be changed here. Press L or Esc to go back to the small list and edit."
      onclick={backToPopup}
    >
      View only · <kbd>L</kbd> to edit
    </button>
    <span class="hint">Tab to switch</span>
  </header>

  {#if view === "open"}
    <FilterBar {todos} bind:catFilter bind:dueFilter bind:menu={filterMenu} />
  {/if}

  <div class="list" bind:this={listEl}>
    <div class="content">
      <div class="print-head">
        <h1>Purser — {viewTitle}</h1>
        <span class="printed">
          Printed {printedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </span>
      </div>

      {#if isEmpty}
        <p class="empty">
          {#if view === "done"}
            Nothing done yet.
          {:else if todos.length > 0}
            No todos match the filters.
          {:else}
            Nothing to do 🎉
          {/if}
        </p>
      {/if}

      {#each groups as group (group.id ?? "none")}
        <section class="group">
          {#if view === "open"}
            <h2>
              {#if group.id}
                <span class="dot" style:background={group.color ?? "#6ea8fe"}></span>
              {/if}
              {group.topic}
            </h2>
          {/if}
          {#each group.todos as todo (todo.id)}
            {@const status = view === "open" ? dueStatus(todo.due_at) : null}
            <div class="todo">
              <div class="row">
                <span class="check">{view === "done" ? "✓" : "○"}</span>
                <span class="text">{todo.text}</span>
                {#if todo.due_at}
                  <span class="due" class:overdue={status === "overdue"} class:soon={status === "soon"}>
                    {formatDue(todo.due_at)}
                    <!-- printouts can't rely on color: spell the urgency out -->
                    {#if status === "overdue"}
                      <span class="due-flag">(overdue)</span>
                    {:else if status === "soon"}
                      <span class="due-flag">(due soon)</span>
                    {/if}
                  </span>
                {/if}
              </div>
              {#if todo.notes}
                <div class="notes">
                  {#each linkify(todo.notes) as part, i (i)}
                    {#if part.link}
                      <button class="link" title="Open in browser" onclick={() => openUrl(part.value)}
                        >{part.value}</button
                      >
                    {:else}{part.value}{/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </section>
      {/each}
    </div>
  </div>

  <footer>
    <span class="hints">
      <span class="hint"><kbd>↑</kbd> <kbd>↓</kbd> scroll</span>
      {#if view === "open"}
        <span class="hint"><kbd>T</kbd> category</span>
        <span class="hint"><kbd>F</kbd> due date</span>
      {/if}
      <span class="hint"><kbd>Ctrl+P</kbd> print</span>
      <span class="hint"><kbd>L</kbd> / <kbd>Esc</kbd> small view</span>
    </span>
    <span class="footer-actions">
      <button class="small-btn" onclick={print} title="Print or save as PDF (Ctrl+P)">Print</button>
      <button class="small-btn" onclick={openHelp} title="Keyboard shortcuts (? / F1)">?</button>
      <img class="wordmark" src={wordmark} alt="Purser" width="60" height="9" />
    </span>
  </footer>
</main>

<style>
  /* header, footer and rows mirror Popup.svelte so both sizes look alike */
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    border: 1px solid var(--border);
  }
  header {
    display: flex;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    align-items: center;
  }
  .tab {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: var(--text-dim);
    cursor: pointer;
  }
  .tab.active {
    color: var(--text);
    border-bottom: 2px solid var(--accent);
  }
  header .hint {
    margin-left: auto;
    font-size: 11px;
    font-weight: 400;
  }
  /* the one place that says this list can't be edited — a dashed pill,
     clickable as the way back to the editable popup */
  .view-only {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 8px;
    background: none;
    border: 1px dashed var(--text-dim);
    border-radius: 999px;
    padding: 1px 10px;
    font: inherit;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
    white-space: nowrap;
  }
  .view-only:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .view-only kbd {
    padding: 0 4px;
    font-size: 10px;
  }
  .list {
    flex: 1;
    overflow-y: auto;
  }
  /* keep lines readable on a wide screen */
  .content {
    max-width: 1100px;
    margin: 0 auto;
    padding: 6px 0 24px;
  }
  .print-head {
    display: none;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    padding: 4px 14px;
    min-height: 34px;
    line-height: 1;
  }
  .dot {
    width: 8px;
    height: 8px;
    margin-top: 1px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .todo {
    padding: 7px 14px;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  /* not a button here: nothing can be ticked */
  .check {
    color: var(--text-dim);
    opacity: 0.6;
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .due {
    font-size: 12px;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .due.overdue {
    color: var(--danger);
  }
  .due.soon {
    color: var(--warn);
  }
  .due-flag {
    display: none;
  }
  /* same panel as the popup's expanded notes, always open */
  .notes {
    margin: 4px 0 0 20px;
    padding: 6px 10px;
    background: var(--bg-raised);
    border-left: 2px solid var(--border);
    border-radius: 0 4px 4px 0;
    font-size: 12px;
    color: var(--text-dim);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-align: left;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .empty {
    color: var(--text-dim);
    text-align: center;
    padding: 30px 0;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 14px;
    font-size: 11px;
    color: var(--text-dim);
    border-top: 1px solid var(--border);
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 12px;
    align-items: center;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 5px;
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
    line-height: 1.3;
    color: var(--text);
    white-space: nowrap;
  }
  .footer-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .small-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 7px;
    font: inherit;
    font-size: 12px;
    line-height: 16px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .small-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .wordmark {
    height: 9px;
    opacity: 0.75;
    display: block;
  }

  @media print {
    /* light theme with black text, whatever the screen theme is */
    :global(:root) {
      color-scheme: light;
      --bg: #fff;
      --bg-raised: #fff;
      --border: #ccc;
      --text: #000;
      --text-dim: #333;
      --accent: #000;
      --danger: #000;
      --warn: #000;
    }
    /* let the whole list flow onto pages, not only the visible part */
    :global(body),
    main,
    .list {
      height: auto;
      overflow: visible;
    }
    main {
      border: none;
    }
    header,
    footer,
    :global(.filterbar) {
      display: none;
    }
    .content {
      max-width: none;
      padding: 0;
    }
    .print-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      padding: 0 0 8px;
      border-bottom: 2px solid #000;
    }
    h1 {
      font-size: 16px;
    }
    .printed {
      font-size: 11px;
      white-space: nowrap;
    }
    h2 {
      break-after: avoid;
      padding-left: 0;
    }
    .todo {
      break-inside: avoid;
      padding-left: 0;
      padding-right: 0;
    }
    .due.overdue {
      font-weight: 600;
    }
    .due-flag {
      display: inline;
    }
    .link {
      color: #000;
    }
  }

  @page {
    margin: 15mm;
  }
</style>
