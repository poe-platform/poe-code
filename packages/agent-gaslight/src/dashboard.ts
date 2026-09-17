import type { HarnessDashboard } from "@poe-code/agent-harness-tools";
import type { GaslightConfig, GaslightEvent } from "./types.js";

export function createGaslightDashboardObserver(
  view: HarnessDashboard,
  config: Pick<GaslightConfig, "setup" | "prompt" | "followups" | "teardown">
): (event: GaslightEvent) => void {
  const labels = [
    ...(config.setup ? ["Setup"] : []),
    "Implement plan",
    ...config.followups.map((prompt) => prompt.trim().split("\n")[0]!),
    ...(config.teardown ? ["Teardown"] : [])
  ];
  return (event) => {
    const finished = event.type === "round.finished";
    const tasks = Array.from({ length: event.total }, (_, index) => ({
      id: `round-${index + 1}`,
      title: labels[index] ?? `Round ${index + 1}`,
      status: index + 1 < event.round || (index + 1 === event.round && finished) ? "completed" as const
        : index + 1 === event.round ? "running" as const : "pending" as const
    }));
    view.updateRun({ tasks, phase: finished ? undefined : tasks[event.round - 1]?.title,
      activeTaskId: finished ? undefined : `round-${event.round}`, activeStep: undefined });
  };
}
