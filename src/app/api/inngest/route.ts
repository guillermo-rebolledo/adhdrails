import { serve } from "inngest/next";

import { inngest } from "@/server/inngest/client";
import { inngestFunctions } from "@/server/inngest/functions";

/**
 * The Inngest endpoint. Inngest invokes registered functions here over HTTP, so
 * durable Calendar synchronization (MEM-41) runs out of band from request
 * handling. Signing is handled by `INNGEST_SIGNING_KEY` in deployed environments.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
