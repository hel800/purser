<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import wordmark from "./assets/purser-wordmark.png";

  const REPO_URL = "https://github.com/hel800/purser";

  // set by vite's define at build time
  declare const __BUILD_DATE__: string;
  const releaseDate = new Date(__BUILD_DATE__ + "T00:00:00Z");
  const released = releaseDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  let version = $state("");

  onMount(async () => {
    version = await getVersion();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") getCurrentWindow().hide();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main>
  <img class="wordmark" src={wordmark} alt="Purser" width="160" height="24" />
  <p class="version">Version {version}</p>
  <p class="meta">MIT License · Released {released}</p>
  <button class="link" onclick={() => openUrl(REPO_URL)}>github.com/hel800/purser</button>
</main>

<style>
  main {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px solid var(--border);
  }
  .wordmark {
    height: 24px;
  }
  .version {
    font-size: 12px;
    color: var(--text-dim);
  }
  .meta {
    font-size: 12px;
    color: var(--text-dim);
    opacity: 0.75;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 12px;
    color: var(--accent);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
