import { Inngest } from "inngest";

/**
 * The Inngest client Rails uses for durable background work (MEM-41). Inngest
 * owns retry, throttling, and run history; Rails keeps the business logic in
 * injectable services and only the thin function wrappers here depend on the
 * runtime. Events are typed by name at the call site (see `sync-dispatcher.ts`).
 */
export const inngest = new Inngest({ id: "rails" });
