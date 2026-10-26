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
      coverage: {
        provider: "v8",
        // listing every source file makes untested ones count as 0%
        include: ["src/**/*.{ts,svelte}"],
        exclude: [
          "src/**/*.test.ts",
          "src/vite-env.d.ts",
          // the window entry files only call mount() on their component
          "src/{about,help,list,popup,quickadd}.ts",
        ],
        reporter: ["text", "html", "json-summary"],
        // raised by hand as tests are added, so coverage can only go up;
        // `vitest run --coverage` exits non-zero below these
        thresholds: { lines: 27, statements: 27, functions: 35, branches: 29 },
      },
    },
  })
);
