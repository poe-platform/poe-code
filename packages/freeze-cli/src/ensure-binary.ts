import { accessSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";

type EnsureOptions = {
  probeTimeoutMs?: number;
};

export async function ensureFreezeBinary(
  binaryPath: string,
  downloadScriptPath: string,
  options: EnsureOptions = {}
): Promise<void> {
  const probeTimeoutMs = options.probeTimeoutMs ?? 3000;
  const hasBinary = existsSync(binaryPath);
  let isExecutable = false;

  if (hasBinary) {
    try {
      accessSync(binaryPath);
      isExecutable = true;
    } catch {
      isExecutable = false;
    }
  }

  if (!hasBinary || !isExecutable) {
    await runDownload(downloadScriptPath);
    const postDownloadOk = await probeBinary(binaryPath, probeTimeoutMs);
    if (!postDownloadOk) {
      throw new Error(
        `Freeze binary failed health check after download: ${binaryPath}`
      );
    }
    return;
  }

  const probeOk = await probeBinary(binaryPath, probeTimeoutMs);

  if (!probeOk) {
    await runDownload(downloadScriptPath);
    const postDownloadOk = await probeBinary(binaryPath, probeTimeoutMs);
    if (!postDownloadOk) {
      throw new Error(
        `Freeze binary failed health check after download: ${binaryPath}`
      );
    }
  }
}

async function probeBinary(
  binaryPath: string,
  timeoutMs: number
): Promise<boolean> {
  const child = spawn(binaryPath, ["--help"], { stdio: "ignore" });
  const result = await waitForExit(child, timeoutMs);
  return result.code === 0 && !result.signal;
}

async function runDownload(downloadScriptPath: string): Promise<void> {
  const child = spawn(process.execPath, [downloadScriptPath], {
    stdio: "inherit"
  });
  const result = await waitForExit(child);

  if (result.code !== 0) {
    throw new Error(
      `Failed to download freeze binary (exit code ${result.code}).`
    );
  }
}

function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs?: number
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    if (typeof timeoutMs === "number") {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        if (!settled) {
          settled = true;
          resolve({ code: 1, signal: "SIGKILL" });
        }
      }, timeoutMs);
    }

    child.on("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ code: 1, signal: null });
    });

    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ code, signal });
    });
  });
}
