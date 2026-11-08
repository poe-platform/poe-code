import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { HumanInLoopProvider } from "../types.js";
import { buildScript, parseStdout } from "./osascript-script.js";

const execFileAsync = promisify(execFile);

export interface OsascriptProviderOptions {
  title?: string;
  binary?: string;
}

function isUserCanceled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : error === undefined ? "" : String(error);
  const stderr = (error as { stderr?: string } | undefined)?.stderr ?? "";
  return [message, stderr].some((value) => value.includes("User canceled. (-128)"));
}

export function osascriptProvider(options: OsascriptProviderOptions = {}): HumanInLoopProvider {
  const title = options.title ?? "Approval needed";
  const binary = options.binary ?? "osascript";

  return {
    id: "osascript",
    async requestApproval(request) {
      const script = buildScript(request, title);

      try {
        const { stdout } = await execFileAsync(binary, ["-e", script]);
        return parseStdout(stdout);
      } catch (error) {
        if (hasOwnErrorCode(error, "ENOENT")) {
          throw new Error("osascript not found — provide a different provider on this platform");
        }
        if (isUserCanceled(error)) {
          return { outcome: "declined" };
        }

        const stderr = (error as { stderr?: string }).stderr ?? String(error);
        throw new Error(`osascript failed: ${stderr.trim()}`);
      }
    }
  };
}

function hasOwnErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === code
  );
}
