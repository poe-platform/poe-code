import { native } from "./native.js";
export const parseSessionUpdate = native.acpParseUpdate;
export function formatSessionUpdate(sessionId, update, meta) {
  native.acpCheckCost(
    update.sessionUpdate === "usage_update" && update.cost != null,
    update.cost?.amount
  );
  return native.acpFormatUpdate(
    sessionId,
    JSON.stringify(update),
    meta === undefined ? undefined : JSON.stringify(meta)
  );
}
