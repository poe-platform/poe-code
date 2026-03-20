import { exec as execCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import { getOptionalString, getRequiredString, resolveAllowedPath } from "./plugin-args.js";

const exec = promisify(execCallback);

type RunCommandFn = (command: string, cwd: string) => Promise<string>;

type ShellPluginOptions = {
  cwd?: string;
  allowedPaths?: string[];
  runCommand?: RunCommandFn;
};

const shellPlugin = (options: ShellPluginOptions = {}): AgentPlugin => {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const allowedPaths = (options.allowedPaths ?? [cwd]).map(allowedPath =>
    path.resolve(cwd, allowedPath),
  );
  const runCommand = options.runCommand ?? defaultRunCommand;

  const runCommandTool = {
    name: "run_command",
    description: "Run a shell command.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to execute.",
        },
        cwd: {
          type: "string",
          description: "Working directory for command execution.",
        },
      },
      required: ["command"],
    },
    async call(args: unknown): Promise<string> {
      const command = getRequiredString(args, "command");
      const commandCwdArg = getOptionalString(args, "cwd");
      const commandCwd = commandCwdArg
        ? resolveAllowedPath(cwd, allowedPaths, commandCwdArg)
        : cwd;

      return runCommand(command, commandCwd);
    },
  };

  return {
    name: "poe-agent-plugin-shell",
    tools: [runCommandTool],
  };
};

async function defaultRunCommand(command: string, cwd: string): Promise<string> {
  try {
    const result = await exec(command, {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });

    const combinedOutput = [result.stdout, result.stderr]
      .map(output => output.trim())
      .filter(output => output.length > 0)
      .join("\n");

    return combinedOutput || "Command completed with no output";
  } catch (error) {
    if (error instanceof Error) {
      const stderr = Reflect.get(error, "stderr");
      if (typeof stderr === "string" && stderr.trim().length > 0) {
        throw new Error(`Command failed: ${stderr.trim()}`);
      }

      const stdout = Reflect.get(error, "stdout");
      if (typeof stdout === "string" && stdout.trim().length > 0) {
        throw new Error(`Command failed: ${stdout.trim()}`);
      }

      throw new Error(`Command failed: ${error.message}`);
    }

    throw new Error(`Command failed: ${String(error)}`);
  }
}

export default shellPlugin;
