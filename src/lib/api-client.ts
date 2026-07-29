/**
 * A small typed HTTP client shared by the UI, synchronization, and tests. It
 * speaks JSON, never throws on non-2xx (the caller inspects `status`), and
 * surfaces the parsed body so callers can read either a success payload or the
 * shared Problem Details envelope.
 */
export interface ApiResponse<T> {
  status: number;
  ok: boolean;
  body: T | null;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });

  const body = (await response.json().catch(() => null)) as T | null;

  return { status: response.status, ok: response.ok, body };
}
