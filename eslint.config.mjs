import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import tanstackQuery from "@tanstack/eslint-plugin-query";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  ...tanstackQuery.configs["flat/recommended"],
  // `.claude/**` holds git worktrees — full copies of this repo. Linting them
  // reports every finding a second time and fails `pnpm verify` (and so any
  // release) on work-in-progress that lives on another branch entirely.
  // `.impeccable/**` is local tool state, not source.
  globalIgnores([
    ".next/**",
    "coverage/**",
    "drizzle/**",
    ".claude/**",
    ".impeccable/**",
  ]),
]);
