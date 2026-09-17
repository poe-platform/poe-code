import { execFile } from "node:child_process";

/** Optional terminal decoration must never prevent a pipeline run. */
export async function setPipelineTerminalName(name: string): Promise<void> {
  try {
    const title = Array.from(name).filter((char) => {
      const code = char.codePointAt(0)!;
      return code >= 32 && (code < 127 || code > 159);
    }).join("").trim();
    if (!title) return;

    if (process.env.TMUX) {
      const pane = process.env.TMUX_PANE;
      if (!pane) return;
      await new Promise<void>((resolve) => {
        execFile("tmux", [
          "rename-window", "-t", pane, "--", title
        ], { timeout: 500 }, () => resolve());
      });
    } else if (process.env.TERM_PROGRAM === "iTerm.app" && process.stdout.isTTY) {
      process.stdout.write(`\u001b]1;${title}\u0007`);
    }
  } catch {
    // Missing tmux, stale panes and unsupported terminals are harmless.
  }
}
