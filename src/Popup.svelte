<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { openTodos, doneTodos, markDone, markOpen, deleteTodo, updateDue, updateText, type Todo } from "./lib/db";
  import { formatDue, isOverdue, parseDueDate } from "./lib/parse";
  import { initSettings } from "./lib/settings.svelte";
  import Logo from "./lib/Logo.svelte";
  import wordmark from "./assets/purser-wordmark.svg";

  type View = "open" | "done";

  let view: View = $state("open");
  let todos: Todo[] = $state([]);
  let selected = $state(0);
  let leaving: { id: number; dir: "left" | "right" } | null = $state(null);
  let editing: { id: number; value: string; field: "due" | "text" } | null = $state(null);

  let editPreview = $derived.by(() => {
    if (!editing || editing.field !== "due") return "";
    const v = editing.value.trim();
    if (!v) return "no due date";
    const iso = parseDueDate(v);
    return iso ? formatDue(iso) : "…";
  });

  const win = getCurrentWindow();

  interface Group {
    topic: string;
    todos: Todo[];
  }

  let groups: Group[] = $derived.by(() => {
    if (view === "done") return todos.length ? [{ topic: "Done", todos }] : [];
    const map = new Map<string, Todo[]>();
    for (const t of todos) {
      const key = t.topic ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()].map(([topic, list]) => ({
      topic: topic || "No topic",
      todos: list,
    }));
  });

  async function reload() {
    todos = view === "open" ? await openTodos() : await doneTodos();
    selected = Math.min(selected, Math.max(0, todos.length - 1));
  }

  onMount(() => {
    initSettings();
    reload();
    const unlisten = listen("purser://refresh", async () => {
      const data = await openTodos();
      view = "open";
      todos = data;
      selected = 0;
      editing = null;
    });
    return () => {
      unlisten.then((f) => f());
    };
  });

  // flat index across groups follows the todos array order because
  // grouping preserves the SQL sort (topic, then due date)
  let flat = $derived(groups.flatMap((g) => g.todos));

  /// tick / restore with a short slide-out: the checkbox state flips first,
  /// then the row slides away (~150ms + ~280ms, under 500ms total)
  async function toggleSelected() {
    const t = flat[selected];
    if (!t || leaving) return;
    leaving = { id: t.id, dir: view === "open" ? "right" : "left" };
    await new Promise((r) => setTimeout(r, 460));
    if (view === "open") await markDone(t.id);
    else await markOpen(t.id);
    // clear the animation state only after the row is gone from the list,
    // otherwise it briefly reappears without the slide-out class
    await reload();
    leaving = null;
  }

  async function switchView(v: View) {
    if (view === v) return;
    // fetch first, then commit view + data together so the old list never
    // re-renders under the new view's grouping (visible intermediate state)
    const data = v === "open" ? await openTodos() : await doneTodos();
    view = v;
    todos = data;
    selected = 0;
    editing = null;
  }

  function startDueEdit(idx: number, todo: Todo) {
    if (leaving) return;
    selected = idx;
    editing = { id: todo.id, value: "", field: "due" };
  }

  function startTextEdit(idx: number, todo: Todo) {
    if (leaving) return;
    selected = idx;
    editing = { id: todo.id, value: todo.text, field: "text" };
  }

  async function onEditKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (!editing) return;
    if (e.key === "Escape") {
      editing = null;
    } else if (e.key === "Enter") {
      const v = editing.value.trim();
      if (editing.field === "due") {
        const iso = v ? parseDueDate(v) : null;
        if (v && !iso) return; // not parseable yet — keep typing
        await updateDue(editing.id, iso);
      } else {
        if (!v) return; // a todo needs text — Esc to cancel
        await updateText(editing.id, v);
      }
      editing = null;
      await reload();
    }
  }

  function focusInput(node: HTMLInputElement) {
    node.focus();
  }

  async function onKeydown(e: KeyboardEvent) {
    if (editing) return;
    switch (e.key) {
      case "Escape":
        await win.hide();
        break;
      case "ArrowDown":
      case "j":
        e.preventDefault();
        if (flat.length) selected = (selected + 1) % flat.length;
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        if (flat.length) selected = (selected - 1 + flat.length) % flat.length;
        break;
      case "Enter":
        await toggleSelected();
        break;
      case "d": {
        const t = flat[selected];
        if (t && view === "open") {
          e.preventDefault();
          startDueEdit(selected, t);
        }
        break;
      }
      case "e":
      case "F2": {
        const t = flat[selected];
        if (t && view === "open") {
          e.preventDefault();
          startTextEdit(selected, t);
        }
        break;
      }
      case "Delete": {
        const t = flat[selected];
        if (t && view === "done") {
          await deleteTodo(t.id);
          await reload();
        }
        break;
      }
      case "Tab":
        e.preventDefault();
        await switchView(view === "open" ? "done" : "open");
        break;
    }
  }

  function scrollSelectedIntoView(node: HTMLElement, isSelected: boolean) {
    function update(sel: boolean) {
      if (sel) node.scrollIntoView({ block: "nearest" });
    }
    update(isSelected);
    return { update };
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
    <span class="hint">Tab to switch</span>
  </header>

  <div class="list">
    {#if flat.length === 0}
      <p class="empty">
        {view === "open" ? "Nothing to do 🎉" : "Nothing done yet."}
      </p>
    {/if}
    {#each groups as group (group.topic)}
      {#if view === "open"}
        <h2>{group.topic}</h2>
      {/if}
      {#each group.todos as todo (todo.id)}
        {@const idx = flat.indexOf(todo)}
        <div
          class="todo"
          class:selected={idx === selected}
          class:leaving-right={leaving?.id === todo.id && leaving.dir === "right"}
          class:leaving-left={leaving?.id === todo.id && leaving.dir === "left"}
          use:scrollSelectedIntoView={idx === selected}
          onclick={() => (selected = idx)}
          role="option"
          aria-selected={idx === selected}
          tabindex="-1"
          onkeydown={() => {}}
        >
          <button
            class="check"
            class:ticked={leaving?.id === todo.id && leaving.dir === "right"}
            title={view === "open" ? "Mark as done" : "Move back to open"}
            onclick={(e) => {
              e.stopPropagation();
              selected = idx;
              toggleSelected();
            }}
          >
            {#if leaving?.id === todo.id}
              {leaving.dir === "right" ? "✓" : "○"}
            {:else}
              {view === "done" ? "✓" : "○"}
            {/if}
          </button>
          {#if editing?.id === todo.id && editing.field === "text"}
            <input
              class="edit text-edit"
              bind:value={editing.value}
              onkeydown={onEditKeydown}
              use:focusInput
              spellcheck="false"
            />
          {:else}
            <span class="text" title={todo.text}>{todo.text}</span>
          {/if}
          {#if editing?.id === todo.id && editing.field === "due"}
            <input
              class="edit"
              bind:value={editing.value}
              onkeydown={onEditKeydown}
              use:focusInput
              placeholder="friday 5pm · empty = none"
              spellcheck="false"
            />
            <span class="preview">{editPreview}</span>
          {:else}
            {#if todo.due_at}
              <span class="due" class:overdue={view === "open" && isOverdue(todo.due_at)}>
                {formatDue(todo.due_at)}
              </span>
            {/if}
            {#if view === "open"}
              <button
                class="pen"
                title={todo.due_at ? "Edit due date" : "Add due date"}
                onclick={(e) => {
                  e.stopPropagation();
                  startDueEdit(idx, todo);
                }}
              >
                ✎
              </button>
            {/if}
          {/if}
        </div>
      {/each}
    {/each}
  </div>

  <footer>
    <span>
      ↑↓ navigate · Enter {view === "open" ? "done · E edit · D due date" : "restore · Del remove"} · Esc close
    </span>
    <img class="wordmark" src={wordmark} alt="Purser" />
  </footer>
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
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
  }
  h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    padding: 10px 14px 4px;
  }
  .todo {
    display: flex;
    gap: 10px;
    padding: 7px 14px;
    align-items: baseline;
    cursor: default;
  }
  .todo.selected {
    background: var(--bg-raised);
  }
  .todo.leaving-right,
  .todo.leaving-left {
    /* checkbox flips instantly, row slides away after a beat */
    transition:
      transform 0.28s ease 0.15s,
      opacity 0.28s ease 0.15s;
  }
  .todo.leaving-right {
    transform: translateX(110%);
    opacity: 0;
  }
  .todo.leaving-left {
    transform: translateX(-110%);
    opacity: 0;
  }
  .check {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text-dim);
    cursor: pointer;
  }
  .check:hover {
    color: var(--ok);
  }
  .check.ticked {
    color: var(--ok);
  }
  .pen {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 12px;
    color: var(--text-dim);
    cursor: pointer;
    opacity: 0;
  }
  .todo:hover .pen,
  .todo.selected .pen {
    opacity: 0.8;
  }
  .pen:hover {
    color: var(--accent);
    opacity: 1;
  }
  .edit {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    padding: 2px 6px;
    width: 150px;
    outline: none;
  }
  .edit:focus {
    border-color: var(--accent);
  }
  .text-edit {
    flex: 1;
    width: auto;
    font-size: inherit;
  }
  .preview {
    font-size: 12px;
    color: var(--accent);
    white-space: nowrap;
  }
  .text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-height: 1.5em;
    transition: max-height 0.15s ease;
  }
  /* the selected todo expands to show its full text */
  .todo.selected .text {
    white-space: normal;
    overflow-wrap: anywhere;
    max-height: 10em;
  }
  .due {
    font-size: 12px;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .due.overdue {
    color: var(--danger);
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
  .wordmark {
    height: 9px;
    opacity: 0.75;
    flex-shrink: 0;
  }
</style>
