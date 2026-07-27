import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import tanstackQuery from "@tanstack/eslint-plugin-query";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  ...tanstackQuery.configs["flat/recommended"],
  globalIgnores([".next/**", "coverage/**", "drizzle/**"]),
]);
