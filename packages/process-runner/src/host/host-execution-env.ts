import { createHostRunner } from "./host-runner.js";
import type { ExecutionEnvFactory, OpenedEnv, RunSpec } from "../types.js";

export const hostExecutionEnvFactory: ExecutionEnvFactory = {
  type: "host",
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
        return createHostRunner().exec({
          command: shellSpec?.command ?? openSpec.env.SHELL ?? process.env.SHELL ?? "sh",
          ...(shellSpec?.args ? { args: shellSpec.args } : {}),
          cwd: openSpec.cwd,
          env: shellSpec && "env" in shellSpec ? shellSpec.env : openSpec.env,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          tty: true
        });
      },
      async close() {}
    };
  },
  async attach() {
    throw new Error("host runtime does not support reattach");
  }
};
