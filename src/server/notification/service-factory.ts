import { getDatabase } from "@/server/db/connection";

import { readWebPushConfig } from "./env";
import { createNotificationRepository } from "./repository";
import {
  createReminderDeliveryService,
  type ReminderDeliveryService,
} from "./reminder-service";
import { createNotificationService } from "./service";
import { createWebPushAdapter } from "./web-push-adapter";

export function getNotificationRepository() {
  return createNotificationRepository(getDatabase());
}

export function getReminderDeliveryService(): ReminderDeliveryService {
  return createReminderDeliveryService(
    getNotificationRepository(),
    createWebPushAdapter(readWebPushConfig()),
  );
}

export function getNotificationService() {
  return createNotificationService(getNotificationRepository(), () =>
    createWebPushAdapter(readWebPushConfig()),
  );
}
