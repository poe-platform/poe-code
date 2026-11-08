import { createHostRunner } from "./host-runner.js";
import type { ExecutionEnvFactory, OpenedEnv, RunSpec } from "../types.js";

export const hostExecutionEnvFactory: ExecutionEnvFactory = {
  type: "host",
  supportsDetach: false,
  supportsWorkspaceTransfer: false,
  async open(openSpec): Promise<OpenedEnv> {
    return {
      id: "host",
      job: null,
      async uploadWorkspace() {
        return {
          files: 0,
          bytes: 0,
          skipped: []
        };
      },
      async downloadWorkspace() {
        return {
          files: 0,
          bytes: 0,
          conflicts: []
        };
      },
      exec(spec: RunSpec) {
        return createHostRunner().exec(spec);
      },
      async detach() {
        throw new Error("host runtime does not support detach because host has no addressable env");
      },
      shell() {
        const shellSpec = openSpec.shellSpec;
        const shellArgs = getOwnShellSpecProperty(shellSpec, "args");
        const shellCwd = getOwnShellSpecProperty(shellSpec, "cwd");
        const shellEnv = getOwnShellSpecProperty(shellSpec, "env");
        const shellSignal = getOwnShellSpecProperty(shellSpec, "signal");
        return createHostRunner().exec({
          command:
            getOwnShellSpecProperty(shellSpec, "command") ??
            openSpec.env.SHELL ??
            process.env.SHELL ??
            "sh",
          ...(shellArgs ? { args: shellArgs } : {}),
          cwd: shellCwd ?? openSpec.cwd,
          env: hasOwnShellSpecProperty(shellSpec, "env") ? shellEnv : openSpec.env,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          tty: true,
          ...(shellSignal === undefined ? {} : { signal: shellSignal })
        });
      },
      async close() {}
    };
  },
  async attach() {
    throw new Error("host runtime does not support reattach");
  }
};

function getOwnShellSpecProperty<Name extends keyof RunSpec>(
  shellSpec: RunSpec | undefined,
  name: Name
): RunSpec[Name] | undefined {
  return hasOwnShellSpecProperty(shellSpec, name) ? shellSpec[name] : undefined;
}

function hasOwnShellSpecProperty<Name extends keyof RunSpec>(
  shellSpec: RunSpec | undefined,
  name: Name
): shellSpec is RunSpec & Record<Name, RunSpec[Name]> {
  return shellSpec !== undefined && Object.prototype.hasOwnProperty.call(shellSpec, name);
}
