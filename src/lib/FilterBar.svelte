<script lang="ts">
  import type { Todo } from "./db";
  import {
    DUE_CYCLE,
    DUE_LABELS,
    categoryCycle,
    categoryInfo,
    type CategoryFilter,
    type DueFilter,
  } from "./filters";

  /** The category and due-date filter pills with their dropdowns, shared by
   *  the popup and the full list window. Keyboard cycling (T/F) stays with
   *  the owner, which also closes `menu` on any key. */
  let {
    todos,
    catFilter = $bindable(),
    dueFilter = $bindable(),
    menu = $bindable(),
    onchange,
  }: {
    todos: Todo[];
    catFilter: CategoryFilter;
    dueFilter: DueFilter;
    menu: "cat" | "due" | null;
    onchange?: () => void;
  } = $props();

  let catCycle = $derived(categoryCycle(todos));
  let catFilterInfo = $derived(categoryInfo(todos, catFilter));

  function pickCat(c: CategoryFilter) {
    catFilter = c;
    menu = null;
    onchange?.();
  }

  function pickDue(d: DueFilter) {
    dueFilter = d;
    menu = null;
    onchange?.();
  }
</script>

<div class="filterbar">
  <span class="filterwrap">
    <button
      class="filter"
      class:active={catFilter !== null}
      title="Category filter (T cycles)"
      onclick={() => (menu = menu === "cat" ? null : "cat")}
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
    {#if menu === "cat"}
      <div class="fmenu">
        {#each catCycle as c (c ?? "all")}
          {@const info = categoryInfo(todos, c)}
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
      onclick={() => (menu = menu === "due" ? null : "due")}
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
    {#if menu === "due"}
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
{#if menu}
  <div
    class="fmenu-backdrop"
    role="presentation"
    onkeydown={() => {}}
    onclick={() => (menu = null)}
  ></div>
{/if}

<style>
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
  .dot {
    width: 8px;
    height: 8px;
    margin-top: 1px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
