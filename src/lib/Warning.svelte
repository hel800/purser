<script lang="ts">
  /** Warning triangle for error banners. An SVG in the text color, like
   *  Lock.svelte: the ⚠ emoji renders in color on Windows. */
  let { size = 12 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
  <path d="M8 1.8 15 14H1z" stroke-linejoin="round" />
  <path d="M8 6.2v3.6M8 11.6v.4" stroke-linecap="round" />
</svg>

<style>
  svg {
    flex-shrink: 0;
    vertical-align: -2px;
  }
</style>
