<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";

  /** `menu`: a left or right click opens the tray menu (see `show_app_menu`) */
  let { size = 20, menu = false }: { size?: number; menu?: boolean } = $props();

  function openMenu(e: MouseEvent) {
    e.preventDefault();
    invoke("show_app_menu");
  }
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 64 64"
  aria-hidden="true"
  class:menu
  onclick={menu ? openMenu : undefined}
  oncontextmenu={menu ? openMenu : undefined}
>
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
  svg.menu {
    cursor: pointer;
  }
</style>
