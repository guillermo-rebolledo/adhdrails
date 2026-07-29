import { z } from "zod";

export const problemCodeSchema = z.enum([
  "database_unavailable",
  "route_not_found",
  "unauthorized",
  "validation_failed",
  "conflict",
  "not_found",
  "gone",
  "push_unavailable",
  "recurring_series_edit",
  "calendar_reauth_required",
  "rate_limited",
]);

export type ProblemCode = z.infer<typeof problemCodeSchema>;

export const problemDetailsSchema = z.object({
  type: z.url(),
  title: z.string(),
  status: z.number().int(),
  code: problemCodeSchema,
  detail: z.string(),
  correlationId: z.string(),
  retryable: z.boolean(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  current: z.unknown().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export function problemDetail(body: unknown, fallback: string): string {
  const parsed = problemDetailsSchema.safeParse(body);
  return parsed.success ? parsed.data.detail : fallback;
}
