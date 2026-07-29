import { z } from "zod";

/**
 * Content-free product analytics for Rails. Analytics is deliberately the
 * narrowest possible surface: a fixed allowlist of event names, each carrying
 * only enumerated, non-identifying properties. User-authored content — Task and
 * Thought titles, notes, search text, Calendar details, URLs, tokens, and
 * notification payloads — must never reach analytics, so this module never
 * defines a free-text property and `buildAnalyticsEvent` rejects any event that
 * arrives with an unexpected key or an out-of-range value. Umami Cloud provides
 * no session replay, and Rails pins it to the US region.
 */

/** Umami Cloud region and ingest host. The US region is a launch requirement. */
export const UMAMI_REGION = "us" as const;
export const UMAMI_ENDPOINT_HOST = "https://us.umami.is";
/** The hosted tracker script served from the same US host. */
export const UMAMI_SCRIPT_SRC = `${UMAMI_ENDPOINT_HOST}/script.js`;

const energyValue = z.enum(["low", "medium", "high", "unset"]);
const itemType = z.enum(["task", "event", "thought"]);
const themeValue = z.enum(["light", "dark", "system"]);
const surfaceValue = z.enum(["command_menu", "quick_capture", "page"]);
const resultBucket = z.enum(["none", "some"]);

/**
 * The analytics allowlist. Every event uses `.strict()`, so any property that is
 * not declared here — including a stray title, note, or query — fails
 * validation and the event is dropped rather than sent. Properties are always
 * bounded enums or booleans; there is deliberately no string free-text field.
 */
const analyticsEventSchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("onboarding_completed"),
      connectedCalendar: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("inbox_item_captured"),
      surface: surfaceValue.optional(),
      scheduleDetected: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("inbox_item_classified"),
      classifiedAs: itemType.optional(),
    })
    .strict(),
  z
    .object({
      name: z.literal("task_created"),
      surface: surfaceValue.optional(),
      important: z.boolean().optional(),
      energy: energyValue.optional(),
      scheduled: z.boolean().optional(),
    })
    .strict(),
  z.object({ name: z.literal("task_completed") }).strict(),
  z.object({ name: z.literal("thought_created") }).strict(),
  z
    .object({
      name: z.literal("event_created"),
      origin: z.enum(["local", "exported"]).optional(),
    })
    .strict(),
  z.object({ name: z.literal("focus_session_started") }).strict(),
  z
    .object({
      name: z.literal("focus_session_completed"),
      reachedEstimate: z.boolean().optional(),
    })
    .strict(),
  z.object({ name: z.literal("distraction_captured") }).strict(),
  z
    .object({
      name: z.literal("search_performed"),
      results: resultBucket.optional(),
    })
    .strict(),
  z.object({ name: z.literal("calendar_connected") }).strict(),
  z.object({ name: z.literal("calendar_disconnected") }).strict(),
  z.object({ name: z.literal("reminders_enabled") }).strict(),
  z.object({ name: z.literal("data_export_requested") }).strict(),
  z.object({ name: z.literal("account_deletion_requested") }).strict(),
  z
    .object({
      name: z.literal("theme_changed"),
      theme: themeValue.optional(),
    })
    .strict(),
]);

export type AnalyticsEventInput = z.input<typeof analyticsEventSchema>;
export type AnalyticsEventName = AnalyticsEventInput["name"];

/** The verified, ready-to-send shape: an approved name and its bounded data. */
export interface AnalyticsEvent {
  name: AnalyticsEventName;
  data: Record<string, string | boolean>;
}

/** Every approved event name, for exhaustive testing and adapter guards. */
export const ANALYTICS_EVENT_NAMES = analyticsEventSchema.options.map(
  (option) => option.shape.name.value,
) as readonly AnalyticsEventName[];

const APPROVED_NAMES: ReadonlySet<string> = new Set(ANALYTICS_EVENT_NAMES);

export function isApprovedAnalyticsEvent(
  name: string,
): name is AnalyticsEventName {
  return APPROVED_NAMES.has(name);
}

/**
 * Validates an event against the allowlist and returns the exact payload that
 * may be sent, or `null` when the event is unknown, carries an unexpected key,
 * or holds an out-of-range value. Returning `null` rather than throwing lets the
 * adapter drop a bad event silently instead of ever risking a leak.
 */
export function buildAnalyticsEvent(
  input: AnalyticsEventInput,
): AnalyticsEvent | null {
  const parsed = analyticsEventSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }

  const { name, ...rest } = parsed.data;
  const data: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      data[key] = value as string | boolean;
    }
  }

  return { name, data };
}
