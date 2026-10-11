import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuses the app's Vite config so the svelte plugin compiles the
// `.svelte.ts` rune modules that parse.ts imports.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      // fixed zone so date assertions mean the same on a Berlin laptop and
      // a UTC runner; the suites additionally freeze the clock (freezeAt)
      env: { TZ: "Europe/Berlin" },
    },
  })
);
