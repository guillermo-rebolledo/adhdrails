import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library retries `findBy*` and `waitFor` for 1s by default, which is
// generous on an idle machine and far too tight while every core is running
// another worker: a query would give up mid-render and report the previous
// state as the final one. This governs every async query in the suite, so the
// budget lives here rather than being passed at hundreds of call sites.
configure({ asyncUtilTimeout: 5000 });

// Vitest isn't configured with globals, so Testing Library's automatic
// afterEach cleanup never registers. Unmount rendered trees between tests so
// repeat renders don't collide.
afterEach(() => {
  cleanup();
});

if (typeof window !== "undefined") {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorage,
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
