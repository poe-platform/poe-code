import { shouldUseInteractiveDashboard, type Dashboard } from "toolcraft-design";

type DashboardQuitCommandOptions = {
  abortController: AbortController;
  dashboard: Pick<Dashboard, "destroy" | "onCommand" | "stop">;
  requestCancellation: () => void;
  cleanupComplete?: Promise<void>;
};

export { shouldUseInteractiveDashboard };

export function formatDashboardDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatDashboardTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `[${hours}:${minutes}:${seconds}]`;
}

export { createDashboardLineBuffer } from "toolcraft-design";

export function registerDashboardQuitCommands(options: DashboardQuitCommandOptions): void {
  let forceQuitting = false;
  options.dashboard.onCommand((command) => {
    if (command === "quit") {
      options.requestCancellation();
      return;
    }

    if (command !== "forceQuit" || forceQuitting) {
      return;
    }

    forceQuitting = true;
    options.abortController.abort();
    options.dashboard.stop();
    options.dashboard.destroy();
    if (options.cleanupComplete) {
      void options.cleanupComplete.then(() => process.exit(130));
    } else {
      process.exit(130);
    }
  });
}
