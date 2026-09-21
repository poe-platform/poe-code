import type {
  AcpMeta,
  Plan,
  SessionNotification,
  SessionUpdate,
  SessionUpdateNotification
} from "./types.js";
export declare function isPlan(value: unknown): value is Plan;
export declare function isSessionNotification(value: unknown): value is SessionNotification;
export declare function formatSessionUpdate(
  sessionId: string,
  update: SessionUpdate,
  meta?: AcpMeta
): string;
export declare function parseSessionUpdate(
  notificationLine: string
): SessionUpdateNotification | null;
