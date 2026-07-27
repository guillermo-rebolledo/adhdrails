"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. Its base URL defaults to the current origin,
 * so it targets the app's own `/api/auth` handler.
 */
export const authClient = createAuthClient();
