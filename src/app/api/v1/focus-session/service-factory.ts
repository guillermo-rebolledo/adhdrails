import { getDatabase } from "@/server/db/connection";
import {
  createFocusSessionService,
  type FocusSessionService,
} from "@/server/focus/service";
import { createFocusSessionRepository } from "@/server/focus/repository";
import { createTaskRepository } from "@/server/task/repository";

/**
 * Builds a Focus Session service wired to the request-scoped database and a Task
 * ownership check, so a session can only ever focus on a Task owned by the same
 * account. Shared by the `/focus-session` and `/focus-session/[id]` handlers.
 */
export function focusSessionServiceFor(): FocusSessionService {
  const database = getDatabase();
  const taskRepository = createTaskRepository(database);
  return createFocusSessionService(
    createFocusSessionRepository(database),
    () => new Date(),
    async (userId, taskId) =>
      (await taskRepository.getById(userId, taskId)) !== null,
  );
}
