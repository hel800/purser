import { defineConfig, mergeConfig } from "vitest/config";
import { svelteTesting } from "@testing-library/svelte/vite";
import viteConfig from "./vite.config";

// Reuses the app's Vite config so the svelte plugin compiles the
// `.svelte.ts` rune modules that parse.ts imports.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // fixed zone so date assertions mean the same on a Berlin laptop and
      // a UTC runner; the suites additionally freeze the clock (freezeAt)
      env: { TZ: "Europe/Berlin" },
      setupFiles: ["src/test/setup.ts"],
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["src/**/*.test.ts"],
            exclude: ["src/**/*.svelte.test.ts"],
          },
        },
        {
          extends: true,
          // resolves Svelte's browser build (not the SSR one) and unmounts
          // rendered components after each test
          plugins: [svelteTesting()],
          test: {
            name: "dom",
            environment: "jsdom",
            include: ["src/**/*.svelte.test.ts"],
            // in addition to the shared setup.ts
            setupFiles: ["src/test/dom.ts"],
          },
        },
      ],
      coverage: {
        provider: "v8",
        // listing every source file makes untested ones count as 0%
        include: ["src/**/*.{ts,svelte}"],
        exclude: [
          "src/**/*.test.ts",
          "src/**/*.d.ts",
          "src/test/**",
          // the window entry files only call mount() on their component
          "src/{about,help,list,popup,quickadd}.ts",
        ],
        reporter: ["text", "html", "json-summary"],
        // raised by hand as tests are added, so coverage can only go up;
        // `vitest run --coverage` exits non-zero below these
        thresholds: { lines: 45, statements: 44, functions: 52, branches: 50 },
      },
    },
  })
);
