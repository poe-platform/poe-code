import { native } from "./native.js";
import { getOptionalNumber } from "./plugin-args.js";
import { spawn } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import {
  readOptionalString,
  readOptionalStringArray,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
import {
  getOptionalBoolean,
  getOptionalString,
  getRequiredString,
  assertAllowedPathEntries,
  assertNoSymbolicLinkPath,
  normalizeAllowedPaths,
  resolveAllowedPath
} from "./plugin-args.js";
const terminateGracePeriodMs = 1000;

const shellPlugin = (options = {}) => {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const allowedPaths = normalizeAllowedPaths(cwd, options.allowedPaths);
  const runCommand = options.runCommand ?? defaultRunCommand;
  const fs = options.fs ?? fsPromises;
  const backgroundCommands = new Map();
  let nextHandle = 0;
  const runCommandTool = {
    name: "run_command",
    description:
      "Run a shell command. Set run_in_background to true to start it and receive a handle string for read_background or kill_background.",
    policy: {
      read: true,
      edit: true,
      validate: validateRunCommandPolicy
    },
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to execute."
        },
        cwd: {
          type: "string",
          description: "Working directory for command execution."
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds. Defaults to 120 and cannot exceed 600."
        },
        run_in_background: {
          type: "boolean",
          description:
            "When true, start the command and return a background handle instead of waiting."
        }
      },
      required: ["command"]
    },
    async call(args, ctx) {
      const command = getRequiredString(args, "command");
      const commandCwdArg = getOptionalString(args, "cwd");
      const commandCwd = commandCwdArg ? resolveAllowedPath(cwd, allowedPaths, commandCwdArg) : cwd;
      await assertNoSymbolicLinkPath(fs, commandCwd);
      const timeoutMs = native.agentShellTimeout(getOptionalNumber(args, "timeout"));
      const runInBackground = getOptionalBoolean(args, "run_in_background") ?? false;
      if (runInBackground) {
        if (ctx.signal.aborted) {
          throw new Error("Command aborted");
        }
        nextHandle += 1;
        const handle = `background-${nextHandle}`;
        backgroundCommands.set(
          handle,
          createBackgroundCommand(handle, command, commandCwd, timeoutMs, ctx.notify)
        );
        return handle;
      }
      return runCommand(command, commandCwd, {
        signal: ctx.signal,
        timeoutMs,
        notify: ctx.notify
      });
    }
  };
  const readBackgroundTool = {
    name: "read_background",
    description:
      "Read the latest buffered stdout/stderr and status for a background command handle.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Handle returned by run_command when run_in_background is true."
        }
      },
      required: ["handle"]
    },
    async call(args) {
      const handle = getRequiredString(args, "handle");
      const backgroundCommand = getBackgroundCommand(backgroundCommands, handle);
      return formatBackgroundCommand(backgroundCommand);
    }
  };
  const killBackgroundTool = {
    name: "kill_background",
    description: "Terminate a background command handle.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Handle returned by run_command when run_in_background is true."
        }
      },
      required: ["handle"]
    },
    async call(args) {
      const handle = getRequiredString(args, "handle");
      const backgroundCommand = getBackgroundCommand(backgroundCommands, handle);
      if (backgroundCommand.status === "exited") {
        return `Background command already exited: ${handle}`;
      }
      backgroundCommand.terminate();
      await backgroundCommand.completion;
      return `Killed background command: ${handle}`;
    }
  };
  return {
    name: "poe-agent-plugin-shell",
    tools: [runCommandTool, readBackgroundTool, killBackgroundTool],
    async dispose() {
      const pendingStops = [];
      for (const backgroundCommand of backgroundCommands.values()) {
        if (backgroundCommand.status === "exited") {
          continue;
        }
        backgroundCommand.terminate();
        pendingStops.push(backgroundCommand.completion.catch(() => undefined));
      }
      await Promise.all(pendingStops);
      backgroundCommands.clear();
    }
  };
};
function getBackgroundCommand(backgroundCommands, handle) {
  const backgroundCommand = backgroundCommands.get(handle);
  if (!backgroundCommand) {
    throw new Error(`Unknown background handle: ${handle}`);
  }
  return backgroundCommand;
}
function createBackgroundCommand(handle, command, cwd, timeoutMs, notify) {
  const spawned = spawnShellCommand(command, cwd, {
    timeoutMs,
    notify,
    background: true,
    handle
  });
  const backgroundCommand = {
    handle,
    stdout: spawned.stdout,
    stderr: spawned.stderr,
    status: "running",
    exitCode: null,
    exitSignal: null,
    timedOut: false,
    terminate: spawned.terminate,
    completion: spawned.completion.then((outcome) => {
      backgroundCommand.status = "exited";
      backgroundCommand.exitCode = outcome.exitCode;
      backgroundCommand.exitSignal = outcome.exitSignal;
      backgroundCommand.timedOut = outcome.timedOut;
      if (outcome.error) {
        backgroundCommand.error = outcome.error.message;
      }
    })
  };
  return backgroundCommand;
}
function formatBackgroundCommand(backgroundCommand) {
  const lines = [`Handle: ${backgroundCommand.handle}`, `Status: ${backgroundCommand.status}`];
  if (backgroundCommand.exitCode !== null) {
    lines.push(`Exit code: ${backgroundCommand.exitCode}`);
  }
  if (backgroundCommand.exitSignal !== null) {
    lines.push(`Signal: ${backgroundCommand.exitSignal}`);
  }
  if (backgroundCommand.timedOut) {
    lines.push("Timed out: true");
  }
  if (backgroundCommand.error) {
    lines.push(`Error: ${backgroundCommand.error}`);
  }
  lines.push("STDOUT:");
  lines.push(formatCapturedOutput(backgroundCommand.stdout.format()));
  lines.push("STDERR:");
  lines.push(formatCapturedOutput(backgroundCommand.stderr.format()));
  return lines.join("\n");
}
async function defaultRunCommand(command, cwd, options) {
  const spawned = spawnShellCommand(command, cwd, options);
  const outcome = await spawned.completion;
  if (outcome.timedOut) {
    throw new Error(
      getCommandTimeoutMessage(spawned.stdout.format(), spawned.stderr.format(), options.timeoutMs)
    );
  }
  if (outcome.aborted) {
    throw new Error("Command aborted");
  }
  if (outcome.error) {
    throw new Error(`Command failed: ${outcome.error.message}`);
  }
  if (outcome.exitCode !== 0) {
    throw new Error(
      getCommandFailureMessage(spawned.stdout.format(), spawned.stderr.format(), outcome)
    );
  }
  const combinedOutput = combineOutput(spawned.stdout.format(), spawned.stderr.format());
  return combinedOutput || "Command completed with no output";
}
function spawnShellCommand(command, cwd, options) {
  const stdout = new native.NativeAgentShellOutput();
  const stderr = new native.NativeAgentShellOutput();
  let notificationError;
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...(process.platform === "win32" ? {} : { detached: true })
  });
  const notify = (stream, message) => {
    const notifyHook = options.notify;
    if (notifyHook === undefined || message.length === 0) {
      return;
    }
    void Promise.resolve()
      .then(() =>
        notifyHook({
          event: stream === "stdout" ? "shell.stdout" : "shell.stderr",
          message,
          data: {
            background: options.background ?? false,
            command,
            cwd,
            ...(options.handle === undefined ? {} : { handle: options.handle }),
            stream
          }
        })
      )
      .catch((error) => {
        if (notificationError === undefined) {
          notificationError = toError(error);
          terminate();
        }
      });
  };
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    const value = chunk.toString();
    stdout.append(value);
    notify("stdout", value);
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    const value = chunk.toString();
    stderr.append(value);
    notify("stderr", value);
  });
  let terminated = false;
  let aborted = false;
  let timedOut = false;
  let escalationTimer;
  const clearEscalationTimer = () => {
    if (escalationTimer === undefined) {
      return;
    }
    clearTimeout(escalationTimer);
    escalationTimer = undefined;
  };
  const killProcess = (signal) => {
    try {
      if (process.platform !== "win32" && child.pid !== undefined) {
        process.kill(-child.pid, signal);
        return;
      }
      child.kill(signal);
    } catch {
      return;
    }
  };
  const terminate = () => {
    if (terminated) {
      return;
    }
    terminated = true;
    killProcess("SIGTERM");
    escalationTimer = setTimeout(() => {
      killProcess("SIGKILL");
    }, terminateGracePeriodMs);
  };
  const cleanupAbort = bindAbortSignal(options.signal, () => {
    aborted = true;
    terminate();
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, options.timeoutMs);
  const completion = new Promise((resolve) => {
    const resolveOutcome = (outcome) => {
      resolve({
        ...outcome,
        ...(outcome.error === undefined && notificationError ? { error: notificationError } : {})
      });
    };
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearEscalationTimer();
      cleanupAbort();
      resolveOutcome({
        aborted,
        timedOut,
        exitCode: null,
        exitSignal: null,
        error: error instanceof Error ? error : new Error(String(error))
      });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      clearEscalationTimer();
      cleanupAbort();
      resolveOutcome({
        aborted,
        timedOut,
        exitCode: code,
        exitSignal: signal,
        ...(notificationError === undefined ? {} : { error: notificationError })
      });
    });
  });
  return {
    stdout,
    stderr,
    terminate,
    completion
  };
}
function bindAbortSignal(signal, onAbort) {
  if (signal === undefined) {
    return () => {};
  }
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}
function toError(error) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
function combineOutput(stdout, stderr) {
  return [stdout, stderr]
    .map((output) => output.trim())
    .filter((output) => output.length > 0)
    .join("\n");
}
function formatCapturedOutput(output) {
  const trimmed = output.trim();
  return trimmed.length > 0 ? trimmed : "(empty)";
}
function getCommandFailureMessage(stdout, stderr, outcome) {
  const combinedOutput = combineOutput(stdout, stderr);
  if (combinedOutput.length > 0) {
    return `Command failed: ${combinedOutput}`;
  }
  if (outcome.exitSignal !== null) {
    return `Command failed with signal ${outcome.exitSignal}`;
  }
  if (outcome.exitCode !== null) {
    return `Command failed with exit code ${outcome.exitCode}`;
  }
  return "Command failed";
}
function getCommandTimeoutMessage(stdout, stderr, timeoutMs) {
  const message = `Command timed out after ${timeoutMs / 1000} seconds`;
  const combinedOutput = combineOutput(stdout, stderr);
  return combinedOutput.length > 0 ? `${message}: ${combinedOutput}` : message;
}
export default shellPlugin;
export const spec = {
  name: "shell",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, ["cwd", "allowedPaths"]);
    const options = {};
    const cwd = readOptionalString(obj, "cwd");
    if (cwd !== undefined) {
      options.cwd = cwd;
    }
    const allowedPaths = readOptionalStringArray(obj, "allowedPaths");
    if (allowedPaths !== undefined) {
      assertAllowedPathEntries(allowedPaths);
      options.allowedPaths = allowedPaths;
    }
    return options;
  },
  factory: (options) => shellPlugin(options)
};

function validateRunCommandPolicy(args, mode) {
  let command;
  try {
    command = getRequiredString(args, "command");
  } catch {
    return;
  }
  return native.agentShellPolicy(command, mode) ?? undefined;
}
