<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { openTodos, doneTodos, markDone, markOpen, deleteTodo, updateDue, updateText, updateNotes, updateCategory, updateTodoCategory, listCategories, type Todo, type Category } from "./lib/db";
  import { formatDue, dueStatus, parseDueDate, isValidCategoryName, isToday, isThisWeek } from "./lib/parse";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { slide } from "svelte/transition";
  import { initSettings } from "./lib/settings.svelte";
  import Logo from "./lib/Logo.svelte";
  import wordmark from "./assets/purser-wordmark.png";

  type View = "open" | "done";

  let view: View = $state("open");
  let todos: Todo[] = $state([]);
  let selected = $state(0);
  let leaving: { id: number; dir: "left" | "right" } | null = $state(null);
  let editing: { id: number; value: string; field: "due" | "text" } | null = $state(null);
  let catEdit: { id: number; name: string; color: string } | null = $state(null);
  let catMenu: { id: number } | null = $state(null);
  let catMenuActive = $state(0);
  let catMenuValue = $state("");
  let catMenuScrollLeft = $state(0);
  let catMenuInput = $state<HTMLInputElement>();
  let catMenuRows = $state<(HTMLLIElement | null)[]>([]);
  let allCategories: Category[] = $state([]);
  // notes: which todo's panel is expanded, and the inline notes editor
  let notesOpenId: number | null = $state(null);
  let notesEdit: { id: number; value: string } | null = $state(null);

  // filter bar (Open view only): category (null = all, -1 = uncategorized)
  // and a due-date stage, both cycled by keyboard or click
  type DueFilter = "all" | "today" | "week" | "soon" | "overdue" | "nodate";
  let catFilter: number | null = $state(null);
  let dueFilter: DueFilter = $state("all");

  const DUE_CYCLE: DueFilter[] = ["all", "today", "week", "soon", "overdue", "nodate"];
  const DUE_LABELS: Record<DueFilter, string> = {
    all: "Any due date",
    today: "Today",
    week: "This week",
    soon: "Soon or overdue",
    overdue: "Overdue",
    nodate: "No date",
  };

  // categories present in the open list, in list order, for the T cycle
  let catCycle = $derived.by(() => {
    const ids: (number | null)[] = [null];
    for (const t of todos) {
      const key = t.category_id ?? -1;
      if (!ids.includes(key)) ids.push(key);
    }
    return ids;
  });

  function catInfoFor(c: number | null): { label: string; color: string | null } {
    if (c === null) return { label: "All categories", color: null };
    if (c === -1) return { label: "No category", color: null };
    const t = todos.find((t) => t.category_id === c);
    return { label: t?.category_name ?? "?", color: t?.category_color ?? null };
  }

  let catFilterInfo = $derived(catInfoFor(catFilter));

  // clicking a pill opens a dropdown; the T/F keys cycle directly
  let filterMenu: "cat" | "due" | null = $state(null);

  function cycleCat() {
    const i = catCycle.indexOf(catFilter);
    catFilter = catCycle[(i + 1) % catCycle.length] ?? null;
    selected = 0;
    filterMenu = null;
  }

  function cycleDue() {
    const i = DUE_CYCLE.indexOf(dueFilter);
    dueFilter = DUE_CYCLE[(i + 1) % DUE_CYCLE.length];
    selected = 0;
    filterMenu = null;
  }

  function pickCat(c: number | null) {
    catFilter = c;
    selected = 0;
    filterMenu = null;
  }

  function pickDue(d: DueFilter) {
    dueFilter = d;
    selected = 0;
    filterMenu = null;
  }

  function matchesDue(t: Todo): boolean {
    switch (dueFilter) {
      case "all":
        return true;
      case "today":
        return t.due_at !== null && isToday(t.due_at);
      case "week":
        return t.due_at !== null && isThisWeek(t.due_at);
      case "soon":
        return dueStatus(t.due_at) !== null;
      case "overdue":
        return dueStatus(t.due_at) === "overdue";
      case "nodate":
        return t.due_at === null;
    }
  }

  // filters narrow the Open view only; Done always shows everything
  let visibleTodos = $derived.by(() => {
    if (view !== "open") return todos;
    return todos.filter(
      (t) => (catFilter === null || (t.category_id ?? -1) === catFilter) && matchesDue(t)
    );
  });

  // mirror the input's horizontal scroll so the ghost overlay stays glued to
  // the caret when a long name scrolls
  function syncCatMenuScroll() {
    catMenuScrollLeft = catMenuInput?.scrollLeft ?? 0;
  }

  // valid = tag-compatible charset and not a duplicate of another category
  let catNameValid = $derived.by(() => {
    if (!catEdit) return true;
    const name = catEdit.name.trim();
    if (!isValidCategoryName(name)) return false;
    const lower = name.toLowerCase();
    return !allCategories.some((c) => c.id !== catEdit!.id && c.name.toLowerCase() === lower);
  });

  interface CatMenuItem {
    kind: "cat" | "none";
    name?: string;
    color?: string;
    key: string;
  }

  // the pick list below the "new category" input: every category, then a
  // "No topic" row to remove the assignment
  let catMenuItems = $derived.by(() => {
    const items: CatMenuItem[] = [];
    for (const c of allCategories) {
      items.push({ kind: "cat", name: c.name, color: c.color, key: `c${c.id}` });
    }
    items.push({ kind: "none", key: "none" });
    return items;
  });

  // a new-category name needs text and must round-trip through #tag syntax
  let catMenuCreateValid = $derived.by(() => {
    const v = catMenuValue.trim();
    return v.length > 0 && isValidCategoryName(v);
  });

  // grayed-out completion of a unique existing category while typing
  let catMenuGhost = $derived.by(() => {
    if (!catMenu || catMenuActive !== 0) return "";
    const v = catMenuValue;
    if (!v || !isValidCategoryName(v)) return "";
    const lower = v.toLowerCase();
    if (allCategories.some((c) => c.name.toLowerCase() === lower)) return ""; // already complete
    const match = allCategories.find((c) => c.name.toLowerCase().startsWith(lower));
    return match ? match.name.slice(v.length) : "";
  });

  let editPreview = $derived.by(() => {
    if (!editing || editing.field !== "due") return "";
    const v = editing.value.trim();
    if (!v) return "no due date";
    const iso = parseDueDate(v);
    return iso ? formatDue(iso) : "…";
  });

  const win = getCurrentWindow();

  interface Group {
    id: number | null;
    topic: string;
    color: string | null;
    todos: Todo[];
  }

  let groups: Group[] = $derived.by(() => {
    if (view === "done") return todos.length ? [{ id: null, topic: "Done", color: null, todos }] : [];
    const map = new Map<number, Group>();
    for (const t of visibleTodos) {
      const key = t.category_id ?? -1;
      if (!map.has(key)) {
        map.set(key, {
          id: t.category_id,
          topic: t.category_name || "No topic",
          color: t.category_color,
          todos: [],
        });
      }
      map.get(key)!.todos.push(t);
    }
    return [...map.values()];
  });

  async function reload() {
    todos = view === "open" ? await openTodos() : await doneTodos();
    selected = Math.min(selected, Math.max(0, todos.length - 1));
  }

  onMount(() => {
    initSettings();
    reload();
    const unlisten = listen("purser://refresh", async () => {
      // the window is hidden, not destroyed — drop focus a click may have
      // left on a button, or Enter would re-activate it next time
      (document.activeElement as HTMLElement | null)?.blur?.();
      const data = await openTodos();
      view = "open";
      todos = data;
      selected = 0;
      editing = null;
      catEdit = null;
      catMenu = null;
      notesOpenId = null;
      notesEdit = null;
    });
    return () => {
      unlisten.then((f) => f());
    };
  });

  // flat index across groups follows the todos array order because
  // grouping preserves the SQL sort (topic, then due date)
  let flat = $derived(groups.flatMap((g) => g.todos));

  // moving the selection to another todo auto-hides an open notes panel
  $effect(() => {
    if (notesOpenId !== null && flat[selected]?.id !== notesOpenId) {
      notesOpenId = null;
      notesEdit = null;
    }
  });

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

  function openAbout() {
    invoke("open_about");
  }

  function openHelp() {
    invoke("open_help");
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
    catEdit = null;
    catMenu = null;
    notesOpenId = null;
    notesEdit = null;
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

  function openCatMenu(idx: number, todo: Todo) {
    if (leaving) return;
    selected = idx;
    // fresh list for suggestions (quick-add may have added categories)
    listCategories().then((c) => (allCategories = c));
    catMenu = { id: todo.id };
    catMenuActive = 0;
    catMenuValue = "";
  }

  function closeCatMenu() {
    catMenu = null;
    catMenuValue = "";
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

  function focusInput(node: HTMLInputElement | HTMLTextAreaElement) {
    node.focus();
  }

  /** Split note text into plain segments and clickable https?:// links. */
  function linkify(text: string): { link: boolean; value: string }[] {
    return text
      .split(/(https?:\/\/\S+)/g)
      .filter((part) => part !== "")
      .map((part) => ({ link: /^https?:\/\//.test(part), value: part }));
  }

  /** Indicator click: toggle existing notes, or start writing the first one. */
  function toggleNotes(idx: number, todo: Todo) {
    selected = idx;
    if (notesEdit) return;
    if (!todo.notes) {
      if (view === "open") startNotesEdit(idx, todo);
      return;
    }
    notesOpenId = notesOpenId === todo.id ? null : todo.id;
  }

  function startNotesEdit(idx: number, todo: Todo) {
    if (leaving || view !== "open") return;
    selected = idx;
    notesOpenId = todo.id;
    notesEdit = { id: todo.id, value: todo.notes ?? "" };
  }

  async function saveNotesEdit() {
    if (!notesEdit) return;
    const { id } = notesEdit;
    const value = notesEdit.value.trim();
    notesEdit = null;
    await updateNotes(id, value || null);
    if (!value) notesOpenId = null; // note removed — nothing left to show
    await reload();
  }

  function cancelNotesEdit() {
    if (notesEdit) {
      // collapse the panel again if the todo never had a note to show
      const id = notesEdit.id;
      const todo = todos.find((t) => t.id === id);
      if (!todo?.notes) notesOpenId = null;
    }
    notesEdit = null;
  }

  async function onNotesEditKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      cancelNotesEdit();
    } else if (e.key === "Enter" && e.ctrlKey) {
      await saveNotesEdit();
    }
  }

  // clicking anywhere outside the notes editor discards the edit
  function onNotesFocusout(e: FocusEvent) {
    const wrap = e.currentTarget as HTMLElement;
    if (!wrap.contains(e.relatedTarget as Node | null)) cancelNotesEdit();
  }

  // clicking anywhere outside a todo text/due editor discards the edit,
  // matching the category editor's behavior
  function cancelEdit() {
    editing = null;
  }

  function startCatEdit(group: Group) {
    if (!group.id || catEdit) return;
    // fresh list for duplicate detection (quick-add may have added categories)
    listCategories().then((c) => (allCategories = c));
    catEdit = { id: group.id, name: group.topic, color: group.color ?? "#6ea8fe" };
  }

  async function saveCatEdit() {
    if (!catEdit || !catNameValid) return;
    const { id, color } = catEdit;
    const name = catEdit.name.trim();
    catEdit = null;
    await updateCategory(id, name, color);
    await reload();
  }

  function cancelCatEdit() {
    catEdit = null;
  }

  // clicking anywhere outside the editor discards the edit (old name stays)
  function onCatEditFocusout(e: FocusEvent) {
    const wrap = e.currentTarget as HTMLElement;
    if (!wrap.contains(e.relatedTarget as Node | null)) cancelCatEdit();
  }

  async function onCatEditKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") await saveCatEdit();
    else if (e.key === "Escape") cancelCatEdit();
  }

  function catMenuMove(dir: 1 | -1) {
    catMenuActive = Math.min(Math.max(catMenuActive + dir, 0), catMenuItems.length);
    // keyboard navigation moves focus so typing lands in the list (j/k nav)
    // instead of the "new category" input
    if (catMenuActive === 0) catMenuInput?.focus();
    else catMenuRows[catMenuActive - 1]?.focus();
  }

  async function catMenuChoose(activeIndex: number) {
    if (!catMenu) return;
    // row 0 is the "new category" input — Enter creates it (empty names ignored)
    if (activeIndex === 0) {
      catMenuActive = 0;
      catMenuInput?.focus();
      if (!catMenuCreateValid) return;
      await updateTodoCategory(catMenu.id, catMenuValue.trim());
      closeCatMenu();
      await reload();
      return;
    }
    const item = catMenuItems[activeIndex - 1];
    if (!item) return;
    await updateTodoCategory(catMenu.id, item.kind === "none" ? null : (item.name ?? null));
    closeCatMenu();
    await reload();
  }

  async function onCatMenuKeydown(e: KeyboardEvent) {
    if (!catMenu) return;
    switch (e.key) {
      case "Escape":
        closeCatMenu();
        break;
      case "ArrowDown":
        e.preventDefault();
        catMenuMove(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        catMenuMove(-1);
        break;
      case "j":
      case "k":
        // only navigate while the list is active — inside the input these
        // must type normally
        if (catMenuActive !== 0) {
          e.preventDefault();
          catMenuMove(e.key === "j" ? 1 : -1);
        }
        break;
      case "Enter":
        e.preventDefault();
        await catMenuChoose(catMenuActive);
        break;
      case "Tab":
        // accept the grayed-out completion instead of tabbing away
        e.preventDefault();
        acceptCatMenuGhost();
        break;
      case "ArrowRight":
        if (catMenuActive === 0 && catMenuGhost) {
          e.preventDefault();
          acceptCatMenuGhost();
        }
        break;
    }
  }

  function acceptCatMenuGhost() {
    if (!catMenuGhost) return;
    catMenuValue += catMenuGhost;
  }

  function menuScrollIntoView(node: HTMLElement, active: boolean) {
    function update(a: boolean) {
      if (a) node.scrollIntoView({ block: "nearest" });
    }
    update(active);
    return { update };
  }

  async function onKeydown(e: KeyboardEvent) {
    if (editing || notesEdit) return;
    if (filterMenu) {
      // any key closes the dropdown; T/F etc. still do their job below
      filterMenu = null;
      if (e.key === "Escape") return;
    }
    if (catEdit) {
      // never let an orphaned category edit lock the keyboard
      if (e.key === "Escape") cancelCatEdit();
      return;
    }
    if (catMenu) {
      // the category menu takes over the arrow/enter/escape keys
      await onCatMenuKeydown(e);
      return;
    }
    switch (e.key) {
      case "Escape":
        await win.hide();
        break;
      case "ArrowDown":
      case "j":
        e.preventDefault();
        if (flat.length) selected = Math.min(selected + 1, flat.length - 1);
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        if (flat.length) selected = Math.max(selected - 1, 0);
        break;
      case "Enter":
        // a previously clicked button (tab, pen, wordmark…) may still hold
        // focus — block its default Enter activation, only toggle the todo
        e.preventDefault();
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
      case "c": {
        const t = flat[selected];
        if (t && view === "open") {
          e.preventDefault();
          openCatMenu(selected, t);
        }
        break;
      }
      case "t": {
        if (view === "open") {
          e.preventDefault();
          cycleCat();
        }
        break;
      }
      case "f": {
        if (view === "open") {
          e.preventDefault();
          cycleDue();
        }
        break;
      }
      case " ": {
        // also blocks a focused button from being space-activated
        e.preventDefault();
        const t = flat[selected];
        if (t?.notes) notesOpenId = notesOpenId === t.id ? null : t.id;
        break;
      }
      case "n": {
        const t = flat[selected];
        if (t && view === "open") {
          e.preventDefault();
          startNotesEdit(selected, t);
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
      case "?":
        e.preventDefault();
        openHelp();
        break;
      case "F1":
        e.preventDefault();
        openHelp();
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

  {#if view === "open"}
    <div class="filterbar">
      <span class="filterwrap">
        <button
          class="filter"
          class:active={catFilter !== null}
          title="Category filter (T cycles)"
          onclick={() => (filterMenu = filterMenu === "cat" ? null : "cat")}
        >
          {#if catFilterInfo.color}
            <span class="dot" style:background={catFilterInfo.color}></span>
          {/if}
          {catFilterInfo.label}
          {#if catFilter !== null}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <span
              class="pill-x"
              role="button"
              tabindex="-1"
              title="Show all categories"
              onclick={(e) => {
                e.stopPropagation();
                pickCat(null);
              }}>✕</span
            >
          {:else}
            <span class="caret">▾</span>
          {/if}
        </button>
        {#if filterMenu === "cat"}
          <div class="fmenu">
            {#each catCycle as c (c ?? "all")}
              {@const info = catInfoFor(c)}
              <button class="fmenu-item" class:sel={catFilter === c} onclick={() => pickCat(c)}>
                {#if info.color}
                  <span class="dot" style:background={info.color}></span>
                {/if}
                {info.label}
              </button>
            {/each}
          </div>
        {/if}
      </span>
      <span class="filterwrap">
        <button
          class="filter"
          class:active={dueFilter !== "all"}
          title="Due-date filter (F cycles)"
          onclick={() => (filterMenu = filterMenu === "due" ? null : "due")}
        >
          {DUE_LABELS[dueFilter]}
          {#if dueFilter !== "all"}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <span
              class="pill-x"
              role="button"
              tabindex="-1"
              title="Show all due dates"
              onclick={(e) => {
                e.stopPropagation();
                pickDue("all");
              }}>✕</span
            >
          {:else}
            <span class="caret">▾</span>
          {/if}
        </button>
        {#if filterMenu === "due"}
          <div class="fmenu">
            {#each DUE_CYCLE as d (d)}
              <button class="fmenu-item" class:sel={dueFilter === d} onclick={() => pickDue(d)}>
                {DUE_LABELS[d]}
              </button>
            {/each}
          </div>
        {/if}
      </span>
    </div>
  {/if}
  {#if filterMenu}
    <div
      class="fmenu-backdrop"
      role="presentation"
      onkeydown={() => {}}
      onclick={() => (filterMenu = null)}
    ></div>
  {/if}

  <div class="list">
    {#if flat.length === 0}
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
{#each groups as group (group.id ?? "empty")}
        {#if view === "open"}
          <h2>
            {#if group.id}
              <span class="dot" style:background={group.color ?? "#6ea8fe"}></span>
            {/if}
            {#if catEdit?.id === group.id}
              <span class="cat-editor" onfocusout={onCatEditFocusout}>
                <input
                  class="cat-edit"
                  class:invalid={!catNameValid}
                  bind:value={catEdit.name}
                  onkeydown={onCatEditKeydown}
                  use:focusInput
                  spellcheck="false"
                />
                <input class="cat-color" type="color" bind:value={catEdit.color} onkeydown={(e) => e.stopPropagation()} title="Category color" />
                <button class="cat-confirm" title={catNameValid ? "Save" : "Invalid or duplicate name"} disabled={!catNameValid} onclick={saveCatEdit}>✓</button>
                <button class="cat-cancel" title="Cancel (Esc)" onclick={cancelCatEdit}>✕</button>
              </span>
            {:else}
              {group.topic}
              {#if group.id}
                <button class="pen" title="Edit category" onclick={() => startCatEdit(group)}>✎</button>
              {/if}
            {/if}
          </h2>
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
              onfocusout={cancelEdit}
              use:focusInput
              spellcheck="false"
            />
          {:else}
            <span class="textwrap">
              {#if todo.notes}
                <!-- inline prefix of the name: titles without notes start here -->
                <button
                  class="note-ind has"
                  title={notesOpenId === todo.id ? "Hide notes (Space)" : "Show notes (Space)"}
                  onclick={(e) => {
                    e.stopPropagation();
                    toggleNotes(idx, todo);
                  }}
                >
                  ≡
                </button>
              {/if}
              <span class="text" title={todo.text}>{todo.text}</span>
              {#if view === "open"}
                <button
                  class="pen"
                  title="Edit todo (E)"
                  onclick={(e) => {
                    e.stopPropagation();
                    startTextEdit(idx, todo);
                  }}
                >
                  ✎
                </button>
                {#if !todo.notes}
                  <button
                    class="note-ind"
                    title="Add note (N)"
                    onclick={(e) => {
                      e.stopPropagation();
                      toggleNotes(idx, todo);
                    }}
                  >
                    ≡
                  </button>
                {/if}
              {/if}
            </span>
          {/if}
          {#if editing?.id === todo.id && editing.field === "due"}
            <input
              class="edit"
              bind:value={editing.value}
              onkeydown={onEditKeydown}
              onfocusout={cancelEdit}
              use:focusInput
              placeholder="friday 5pm · empty = none"
              spellcheck="false"
            />
            <span class="preview">{editPreview}</span>
          {:else}
            {#if todo.due_at}
              {@const status = view === "open" ? dueStatus(todo.due_at) : null}
              <span class="due" class:overdue={status === "overdue"} class:soon={status === "soon"}>
                {formatDue(todo.due_at)}
              </span>
            {/if}
            {#if view === "open"}
              <button
                class="pen"
                title={todo.due_at ? "Edit due date (D)" : "Add due date (D)"}
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
        {#if notesOpenId === todo.id}
          <div class="notes" transition:slide={{ duration: 150 }}>
            {#if notesEdit?.id === todo.id}
              <span class="notes-editor" onfocusout={onNotesFocusout}>
                <!-- svelte-ignore a11y_autofocus -->
                <textarea
                  class="notes-input"
                  bind:value={notesEdit.value}
                  onkeydown={onNotesEditKeydown}
                  use:focusInput
                  placeholder="Notes, links, instructions… (empty removes the note)"
                  spellcheck="false"
                ></textarea>
                <span class="notes-hint">Ctrl+Enter save · Esc cancel</span>
              </span>
            {:else}
              <span class="notes-text">
                {#each linkify(todo.notes ?? "") as part, i (i)}
                  {#if part.link}
                    <button
                      class="link"
                      title="Open in browser"
                      onclick={(e) => {
                        e.stopPropagation();
                        openUrl(part.value);
                      }}>{part.value}</button
                    >
                  {:else}{part.value}{/if}
                {/each}
              </span>
              {#if view === "open"}
                <button class="pen notes-pen" title="Edit notes (N)" onclick={() => startNotesEdit(idx, todo)}>
                  ✎
                </button>
              {/if}
            {/if}
          </div>
        {/if}
      {/each}
    {/each}
  </div>

  <footer>
    <span class="hints">
      <span class="hint">
        <kbd>Enter</kbd>
        {view === "open" ? "done" : "restore"}
      </span>
      {#if view === "open"}
        <span class="hint"><kbd>E</kbd> edit</span>
        <span class="hint"><kbd>D</kbd> due date</span>
        <span class="hint"><kbd>C</kbd> category</span>
        <span class="hint"><kbd>N</kbd> note</span>
      {:else}
        <span class="hint"><kbd>Del</kbd> remove</span>
      {/if}
      <span class="hint"><kbd>Esc</kbd> close</span>
    </span>
    <span class="footer-actions">
      <button class="help-btn" onclick={openHelp} title="Keyboard shortcuts (? / F1)">?</button>
      <button class="wordmark-btn" onclick={openAbout} title="About Purser">
        <img class="wordmark" src={wordmark} alt="Purser" width="60" height="9" />
      </button>
    </span>
  </footer>
</main>

{#if catMenu}
  <div class="menu-backdrop" role="presentation" onkeydown={() => {}} onclick={closeCatMenu}>
    <div
      class="menu"
      role="listbox"
      tabindex="-1"
      onkeydown={() => {}}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="menu-title">Change category</div>
      <ul class="menu-list">
        <li class="menu-item create" class:active={catMenuActive === 0}>
          <span class="menu-create-wrap" class:invalid={catMenuValue !== "" && !catMenuCreateValid}>
            <input
              class="menu-create-input"
              bind:this={catMenuInput}
              bind:value={catMenuValue}
              use:focusInput
              onscroll={syncCatMenuScroll}
              placeholder="New category…"
              spellcheck="false"
            />
            <!-- always shown: the input's text is transparent, so the overlay
                 renders the typed name with the completion suffix right after it -->
            <span class="menu-ghost" aria-hidden="true" style="transform: translateX({-catMenuScrollLeft}px)">
              <span class="ghost-typed">{catMenuValue}</span>{catMenuGhost}
            </span>
          </span>
        </li>
        {#each catMenuItems as item, i (item.key)}
          <li
            class="menu-item"
            class:active={catMenuActive === i + 1}
            class:none={item.kind === "none"}
            role="option"
            aria-selected={catMenuActive === i + 1}
            tabindex="-1"
            bind:this={catMenuRows[i]}
            use:menuScrollIntoView={catMenuActive === i + 1}
            onclick={() => catMenuChoose(i + 1)}
            onkeydown={() => {}}
            onmouseover={() => (catMenuActive = i + 1)}
            onfocus={() => (catMenuActive = i + 1)}
          >
            {#if item.kind === "none"}
              No topic
            {:else}
              <span class="dot" style:background={item.color}></span>
              {item.name}
            {/if}
          </li>
        {/each}
      </ul>
      <div class="menu-hint">Type name · ↑↓ pick · Enter ok · Esc close</div>
    </div>
  </div>
{/if}

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
  .filterbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
  }
  .filter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 1px 10px;
    font: inherit;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
    white-space: nowrap;
  }
  .filter:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .filter.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .pill-x {
    margin-left: 2px;
    font-size: 11px;
    opacity: 0.7;
  }
  .pill-x:hover {
    color: var(--danger);
    opacity: 1;
  }
  .filter .caret {
    font-size: 9px;
    opacity: 0.7;
  }
  .filterwrap {
    position: relative;
  }
  .fmenu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 16;
    min-width: 160px;
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
  }
  .fmenu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .fmenu-item:hover {
    background: var(--bg);
  }
  .fmenu-item.sel {
    color: var(--accent);
  }
  .fmenu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 15;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
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
    box-sizing: border-box;
    line-height: 1;
  }
  h2 .pen {
    opacity: 0;
    transition: opacity 0.1s ease;
  }
  h2:hover .pen {
    opacity: 0.8;
  }
  h2 .pen:hover {
    opacity: 1;
  }
  .dot {
    width: 8px;
    height: 8px;
    margin-top: 1px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .cat-edit {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--accent);
    font: inherit;
    font-size: 11px;
    text-transform: none;
    letter-spacing: normal;
    padding: 1px 6px;
    width: 140px;
    outline: none;
  }
  .cat-edit:focus {
    border-color: var(--accent);
  }
  .cat-editor {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .cat-edit.invalid,
  .cat-edit.invalid:focus {
    border-color: var(--danger);
    color: var(--danger);
  }
  .cat-confirm:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .cat-cancel {
    background: none;
    border: none;
    padding: 0 2px;
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
  }
  .cat-cancel:hover {
    color: var(--danger);
  }
  .cat-color {
    width: 24px;
    height: 20px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }
  .cat-confirm {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--ok);
    cursor: pointer;
  }
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.45);
  }
  .menu {
    width: 240px;
    max-width: calc(100vw - 40px);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    overflow: hidden;
  }
  .menu-title {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    border-bottom: 1px solid var(--border);
  }
  .menu-list {
    list-style: none;
    margin: 0;
    padding: 4px;
    /* ~6 rows visible, then the list scrolls */
    max-height: 160px;
    overflow-y: auto;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text);
    border-radius: 4px;
    cursor: pointer;
  }
  .menu-item.active {
    background: var(--bg);
  }
  .menu-item.create {
    color: var(--accent);
    font-weight: 600;
  }
  .menu-item.none {
    color: var(--text-dim);
  }
  .menu-item .dot {
    margin: 0;
  }
  .menu-create-wrap {
    flex: 1;
    position: relative;
    min-width: 0;
    /* clip the ghost when a long name scrolls the input */
    overflow: hidden;
  }
  .menu-create-input {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 16px;
    box-sizing: border-box;
    background: transparent;
    border: none;
    outline: none;
    padding: 0;
    color: transparent;
    caret-color: var(--text);
    font-family: inherit;
    font-size: 12px;
    line-height: 16px;
  }
  .menu-create-input::placeholder {
    color: var(--text-dim);
    opacity: 0.7;
  }
  .menu-create-wrap.invalid .menu-create-input {
    caret-color: var(--danger);
  }
  .menu-ghost {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 0;
    color: var(--text-dim);
    opacity: 0.6;
    pointer-events: none;
    white-space: pre;
    overflow: hidden;
    font-family: inherit;
    font-size: 12px;
    line-height: 16px;
  }
  .menu-ghost .ghost-typed {
    color: var(--text);
    opacity: 1;
  }
  .menu-create-wrap.invalid .menu-ghost .ghost-typed {
    color: var(--danger);
  }
  .menu-hint {
    padding: 6px 12px;
    font-size: 11px;
    color: var(--text-dim);
    border-top: 1px solid var(--border);
  }
  .todo {
    display: flex;
    gap: 10px;
    padding: 7px 14px;
    /* 20px content line + 2×7px padding: tall enough for both the normal
       text line (~19.6px) and the 20px edit inputs, so the height never
       changes when entering/leaving edit mode */
    min-height: 34px;
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
  /* mouse affordance only — keyboard users have the E/D shortcuts */
  .todo:hover .pen {
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
    /* same total height as the text line it replaces, and centered instead
       of baseline-aligned so its lower text baseline can't grow the row */
    height: 20px;
    padding: 0 6px;
    align-self: center;
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
  /* flexible middle region: text takes its natural width so the pen
     sits directly after the words, not at the far right edge */
  .textwrap {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    /* ≡ hugs the title (3px); the row gap of 10px minus this pull-in
       leaves ~6px between the check and ≡ — smaller, but still larger */
    gap: 3px;
    margin-left: -4px;
  }
  .textwrap .pen {
    margin-left: 3px; /* keep the usual 6px before the edit pencil */
  }
  .text {
    min-width: 0;
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
  /* notes indicator: dimmed when the todo has notes, hover-only otherwise */
  .note-ind {
    background: none;
    border: none;
    padding: 0;
    width: 12px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0; /* the trailing "add note" variant is a hover affordance */
  }
  .note-ind.has {
    opacity: 0.55;
  }
  .todo:hover .note-ind {
    opacity: 0.8;
  }
  .note-ind:hover {
    color: var(--accent);
    opacity: 1;
  }
  /* expanded notes panel below the row, aligned with the title column */
  .notes {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: -2px 14px 6px 34px;
    padding: 6px 10px;
    background: var(--bg-raised);
    border-left: 2px solid var(--border);
    border-radius: 0 4px 4px 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .notes-text {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 8em;
    overflow-y: auto;
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
  }
  .notes .pen {
    opacity: 0.4;
  }
  .notes:hover .pen {
    opacity: 0.8;
  }
  .notes .pen:hover {
    color: var(--accent);
    opacity: 1;
  }
  .notes-editor {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .notes-input {
    width: 100%;
    min-height: 64px;
    resize: vertical;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    padding: 4px 6px;
    outline: none;
    box-sizing: border-box;
  }
  .notes-input:focus {
    border-color: var(--accent);
  }
  .notes-hint {
    font-size: 11px;
    color: var(--text-dim);
    opacity: 0.8;
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
    font-size: 11px;
    color: var(--text-dim);
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
  .wordmark-btn {
    background: none;
    border: none;
    padding: 0;
    flex-shrink: 0;
    line-height: 0;
    cursor: pointer;
  }
  .footer-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .help-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 7px;
    font: inherit;
    font-size: 12px;
    line-height: 16px;
    color: var(--text-dim);
    cursor: pointer;
    flex-shrink: 0;
  }
  .help-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .wordmark {
    height: 9px;
    opacity: 0.75;
    display: block;
  }
  .wordmark-btn:hover .wordmark {
    opacity: 1;
  }
</style>
