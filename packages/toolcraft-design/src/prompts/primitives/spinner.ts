import { color } from "../../components/color.js";
import { resolveOutputFormat } from "../../internal/output-format.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { SPINNER_FRAMES } from "../../static/spinner.js";

export interface SpinnerOptions {
  start: (message?: string) => void;
  stop: (message?: string, code?: number) => void;
  message: (message?: string) => void;
}

function writeTerminalFrame(frame: string, message: string): void {
  process.stdout.write(`\r\x1b[K${frame}  ${message}`);
}

export function spinner(): SpinnerOptions {
  let currentMessage = "";
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let fallback = false;

  const format = resolveOutputFormat();

  const renderFrame = (): void => {
    writeTerminalFrame(SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length], currentMessage);
  };

  const clearTimer = (): void => {
    if (!timer) {
      return;
    }
    clearInterval(timer);
    timer = undefined;
  };

  return {
    start(message = ""): void {
      currentMessage = stripAnsi(message);

      if (format === "json") {
        return;
      }

      if (format === "markdown") {
        process.stdout.write(`- ${currentMessage}...\n`);
        return;
      }

      fallback = process.env.POE_NO_SPINNER === "1" || !process.stdout.isTTY;
      if (fallback) {
        process.stdout.write(`${color.gray("│")}  ${currentMessage}\n`);
        return;
      }

      frameIndex = 0;
      renderFrame();
      timer = setInterval(() => {
        frameIndex += 1;
        renderFrame();
      }, 16);
    },

    message(message = ""): void {
      currentMessage = stripAnsi(message);

      if (format !== "terminal" || fallback || !timer) {
        return;
      }

      renderFrame();
    },

    stop(message = currentMessage, code?: number): void {
      currentMessage = stripAnsi(message);

      if (format === "json") {
        process.stdout.write(
          `${JSON.stringify({ type: "spinner", state: "stopped", message: currentMessage })}\n`
        );
        return;
      }

      if (format === "markdown") {
        process.stdout.write(`- ${currentMessage}\n`);
        return;
      }

      clearTimer();

      const symbol = code === undefined || code === 0
        ? color.green("◆")
        : color.red("■");

      if (fallback) {
        process.stdout.write(`${symbol}  ${currentMessage}\n`);
        return;
      }

      process.stdout.write(`\r\x1b[K${symbol}  ${currentMessage}\n`);
    }
  };
}
