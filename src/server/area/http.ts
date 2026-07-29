import { type AreaResponse, areaResponseSchema } from "@/domain/area/area";
import { conflictProblem, validationProblem } from "@/server/http/problem";

import type { AreaRecord } from "./repository";
import type { AreaCreateResult } from "./service";

export function serializeArea(record: AreaRecord): AreaResponse {
  return areaResponseSchema.parse({
    id: record.id,
    name: record.name,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

/** Maps a failed create outcome to its Problem Details response. */
export function areaCreateFailureResponse(
  result: Extract<AreaCreateResult, { ok: false }>,
  correlationId: string,
): Response {
  switch (result.reason) {
    case "invalid":
      return validationProblem(correlationId, result.fieldErrors);
    case "conflict":
      return conflictProblem(correlationId, serializeArea(result.current));
  }
}
