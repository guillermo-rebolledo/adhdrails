import { describe, expect, it } from "vitest";

import {
  thoughtCreateRequestSchema,
  thoughtMutationRequestSchema,
} from "./thought";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

describe("Thought mutation contracts", () => {
  it("accepts a lightweight Thought created from an Inbox Item", () => {
    expect(
      thoughtCreateRequestSchema.parse({
        id: ID,
        title: "A useful reference",
        body: "Keep this nearby.",
        sourceInboxItemId: ID,
        idempotencyKey: KEY,
      }),
    ).toMatchObject({ title: "A useful reference", sourceInboxItemId: ID });
  });

  it("requires a base version for edits and deletion state changes", () => {
    expect(
      thoughtMutationRequestSchema.safeParse({
        title: "Updated",
        body: "",
        baseVersion: 0,
        idempotencyKey: KEY,
      }).success,
    ).toBe(false);
  });
});
