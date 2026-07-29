import { z } from "zod";

export const THOUGHT_TITLE_MAX_LENGTH = 200;
export const THOUGHT_BODY_MAX_LENGTH = 20_000;
export const THOUGHT_TOMBSTONE_RETENTION_DAYS = 30;

export const thoughtTitleSchema = z
  .string()
  .trim()
  .min(1, { message: "A Thought needs a title." })
  .max(THOUGHT_TITLE_MAX_LENGTH, { message: "This title is too long." });

export const thoughtBodySchema = z
  .string()
  .trim()
  .max(THOUGHT_BODY_MAX_LENGTH, { message: "These notes are too long." });

export const thoughtCreateRequestSchema = z.object({
  id: z.uuid(),
  title: thoughtTitleSchema,
  body: thoughtBodySchema,
  sourceInboxItemId: z.uuid().nullable().default(null),
  idempotencyKey: z.uuid(),
});

export const thoughtMutationRequestSchema = z.object({
  title: thoughtTitleSchema,
  body: thoughtBodySchema,
  baseVersion: z.number().int().positive(),
  idempotencyKey: z.uuid(),
});

export const thoughtDeletionRequestSchema = z.object({
  deleted: z.boolean(),
  baseVersion: z.number().int().positive(),
  idempotencyKey: z.uuid(),
});

export const thoughtResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  sourceInboxItemId: z.uuid().nullable(),
  version: z.number().int().positive(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ThoughtCreateRequest = z.infer<typeof thoughtCreateRequestSchema>;
export type ThoughtMutationRequest = z.infer<
  typeof thoughtMutationRequestSchema
>;
export type ThoughtDeletionRequest = z.infer<
  typeof thoughtDeletionRequestSchema
>;
export type ThoughtResponse = z.infer<typeof thoughtResponseSchema>;
