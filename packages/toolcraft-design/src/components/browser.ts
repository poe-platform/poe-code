import { spawn } from "node:child_process";
import process from "node:process";

interface BrowserProcess {
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  unref(): void;
}

type SpawnBrowserProcess = (
  command: string,
  args: string[],
  options: { detached: true; stdio: "ignore" }
) => BrowserProcess;

export interface OpenExternalOptions {
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnBrowserProcess;
}

export async function openExternal(url: string, options: OpenExternalOptions = {}): Promise<void> {
  const parsed = new URL(url);
  const { command, args } = browserCommand(parsed.href, options.platform ?? process.platform);
  await launchBrowser(command, args, options.spawnProcess ?? spawn);
}

function browserCommand(url: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (platform === "win32") {
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  }

  return { command: "xdg-open", args: [url] };
}

function launchBrowser(
  command: string,
  args: string[],
  spawnProcess: SpawnBrowserProcess
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { detached: true, stdio: "ignore" });

    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        const reason = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
        reject(new Error(`Browser launcher exited with ${reason}`));
        return;
      }

      child.unref();
      resolve();
    });
  });
}
