<script lang="ts">
  let { size = 20 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
  <rect
    x="6"
    y="6"
    width="52"
    height="52"
    rx="14"
    fill="none"
    stroke="#b7cfff"
    stroke-width="4"
    opacity="0.55"
  />
  <polyline
    points="19.5 33.8 29 43 44.5 22"
    fill="none"
    stroke="#b7cfff"
    stroke-width="5"
    stroke-linecap="round"
    stroke-linejoin="round"
    opacity="0.9"
  />
</svg>

<style>
  svg {
    display: block;
    flex-shrink: 0;
  }
</style>
