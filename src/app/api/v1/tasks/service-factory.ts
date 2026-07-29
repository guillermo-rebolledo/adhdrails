import { createAreaRepository } from "@/server/area/repository";
import { getDatabase } from "@/server/db/connection";
import { createTaskRepository } from "@/server/task/repository";
import { type TaskService, createTaskService } from "@/server/task/service";

/**
 * Builds a Task service wired to the request-scoped database and an Area
 * ownership check, so a Task can only ever reference an Area owned by the same
 * account. Shared by the `/tasks` and `/tasks/[id]` route handlers.
 */
export function taskServiceFor(): TaskService {
  const database = getDatabase();
  const areaRepository = createAreaRepository(database);
  return createTaskService(
    createTaskRepository(database),
    () => new Date(),
    async (userId, areaId) =>
      (await areaRepository.getById(userId, areaId)) !== null,
  );
}
