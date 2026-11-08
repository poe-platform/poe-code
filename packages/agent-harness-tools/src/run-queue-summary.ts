import type { RunQueueSnapshot } from "./run-queue.js";

export function formatRunQueueSummary(snapshot: RunQueueSnapshot): string {
  const plans = snapshot.items.filter((item) => item.kind === "plan");
  const messages = snapshot.items.filter((item) => item.kind === "message");
  const pending = snapshot.items.filter((item) => item.status === "pending").length;
  return [
    `${plans.filter((item) => item.status === "completed").length}/${plans.length} plans`,
    ...(messages.length ? [`${messages.filter((item) => item.status === "completed").length}/${messages.length} messages`] : []),
    ...(pending ? [`${pending} pending`] : [])
  ].join(" · ");
}
