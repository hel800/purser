<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade } from "svelte/transition";

  /** A short message pill above the footer; call `flash()` to show it. */
  let { children }: { children: Snippet } = $props();

  const VISIBLE_MS = 1800;

  let visible = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Shows the message; repeated calls restart the timer instead of stacking. */
  export function flash() {
    visible = true;
    clearTimeout(timer);
    timer = setTimeout(() => (visible = false), VISIBLE_MS);
  }
</script>

{#if visible}
  <div class="toast" role="status" transition:fade={{ duration: 150 }}>
    {@render children()}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: 56px;
    transform: translateX(-50%);
    z-index: 30;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    pointer-events: none;
  }
  .toast :global(kbd) {
    display: inline-block;
    background: var(--bg);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 5px;
    font-family: inherit;
    font-size: 11px;
    line-height: 1.3;
    color: var(--text);
  }
  @media print {
    .toast {
      display: none;
    }
  }
</style>
