import { resolveOutputFormat } from "../internal/output-format.js";

type DashboardIo = {
  stdin: { isTTY?: boolean | undefined };
  stdout: { isTTY?: boolean | undefined };
};

export function shouldUseInteractiveDashboard(
  enabled: boolean | undefined,
  io: DashboardIo = process
): boolean {
  return enabled === true
    && resolveOutputFormat() === "terminal"
    && Boolean(io.stdin.isTTY)
    && Boolean(io.stdout.isTTY);
}
