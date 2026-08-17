import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    // The default 5s is measured against an idle machine. This suite runs ~1000
    // tests across as many workers as there are cores, and its heaviest jsdom
    // cases (rendering a full 100-item bounded window through fake-indexeddb)
    // take ~1.4s alone but over 6s while every other worker competes for CPU.
    // They were failing on contention rather than on anything they assert.
    // Kept well below a wall-clock a genuine hang would blow through.
    testTimeout: 20000,
  },
});
