<script lang="ts">
  /** Lock glyph for read-only todos. An SVG in the text color: the 🔒 emoji
   *  renders in color on Windows and can't be grayed out like the rest. */
  let { size = 11 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
  <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
</svg>

<style>
  svg {
    vertical-align: -1px;
  }
</style>
