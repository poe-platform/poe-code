import { resolveOutputFormat, type Dashboard } from "@poe-code/design-system";

type DashboardIo = {
  stdin: { isTTY?: boolean | undefined };
  stdout: { isTTY?: boolean | undefined };
};

type DashboardQuitCommandOptions = {
  abortController: AbortController;
  dashboard: Pick<Dashboard, "destroy" | "onCommand" | "stop">;
  requestCancellation: () => void;
};

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

export function createDashboardLineBuffer(emit: (line: string) => void): {
  push(chunk: string): void;
  flush(): void;
} {
  let pending = "";

  return {
    push(chunk: string): void {
      pending += chunk;
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        const raw = pending.slice(0, newlineIndex);
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        emit(line);
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
    },
    flush(): void {
      if (pending.length === 0) {
        return;
      }

      const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
      emit(line);
      pending = "";
    }
  };
}

export function shouldUseInteractiveDashboard(
  enabled: boolean | undefined,
  io: DashboardIo = {
    stdin: process.stdin,
    stdout: process.stdout
  }
): boolean {
  return enabled === true
    && resolveOutputFormat() === "terminal"
    && Boolean(io.stdin.isTTY)
    && Boolean(io.stdout.isTTY);
}

export function registerDashboardQuitCommands(options: DashboardQuitCommandOptions): void {
  options.dashboard.onCommand((command) => {
    if (command === "quit") {
      options.requestCancellation();
      return;
    }

    if (command !== "forceQuit") {
      return;
    }

    options.abortController.abort();
    options.dashboard.stop();
    options.dashboard.destroy();
    process.exit(130);
  });
}
