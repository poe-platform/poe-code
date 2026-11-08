import assert from "node:assert/strict";
import { describe, test } from "node:test";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Context = Parameters<NonNullable<ReturnType<Extension["create"]>["event"]>>[1];
type Checkpoint = NonNullable<ReturnType<Extension["create"]>["checkpoint"]>;

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

const cases: readonly { name: string; source: string; events: readonly string[]; status?: number }[] = [
  {
    name: "for body completion",
    source: `for item in a b; do probe "$item"; done`,
    events: ["body:a", "checkpoint", "body:b", "checkpoint"],
  },
  {
    name: "while body completion",
    source: `set -- a b; while test "$#" -gt 0; do probe "$1"; shift; done`,
    events: ["body:a", "checkpoint", "body:b", "checkpoint"],
  },
  {
    name: "until body completion",
    source: `set -- a b; until test "$#" -eq 0; do probe "$1"; shift; done`,
    events: ["body:a", "checkpoint", "body:b", "checkpoint"],
  },
  {
    name: "multilevel break visits both completed bodies",
    source: `for outer in a b; do for inner in x y; do probe "$outer:$inner"; break 2; done; done`,
    events: ["body:a:x", "checkpoint", "checkpoint"],
  },
  {
    name: "multilevel continue visits both completed bodies",
    source: `for outer in a b; do for inner in x y; do probe "$outer:$inner"; continue 2; done; done`,
    events: ["body:a:x", "checkpoint", "checkpoint", "body:b:x", "checkpoint", "checkpoint"],
  },
  {
    name: "return is not normal body completion",
    source: `function collect() { for item in a b; do probe "$item"; return 7; done; }; collect`,
    events: ["body:a"],
    status: 7,
  },
  {
    name: "exit is not normal body completion",
    source: `for item in a b; do probe "$item"; exit 9; done`,
    events: ["body:a"],
    status: 9,
  },
  {
    name: "false initial condition has no completed body",
    source: `while false; do probe never; done`,
    events: [],
  },
  {
    name: "ordinary command does not create a checkpoint",
    source: `probe outside`,
    events: ["body:outside"],
  },
  {
    name: "foreground subshell installs one child job",
    source: `(:)`,
    events: ["checkpoint:child-job-install"],
  },
  {
    name: "foreground pipeline installs one aggregate child job",
    source: `: | :`,
    events: ["checkpoint:child-job-install"],
  },
  {
    name: "active dollar-parenthesis substitution reads parent input",
    source: `value=$(:)`,
    events: ["checkpoint:source-input-read"],
  },
];

describe("compiled generic execution checkpoints", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const route of ["inline", "bash", "sh"] as const) {
    for (const record of cases) {
      test(`${route}: ${record.name}`, async context => {
        const published = await import("poe-code/safe-bash");
        const { createMemoryFileSystem } = await import("poe-code/safe-fs");
        const events: string[] = [];
        const resources: { shell?: import("poe-code/safe-bash").Shell } = {};
        context.after(() => resources.shell?.dispose());
        const checkpoint: Checkpoint = (point, invocation: Context) => {
          assert.equal(invocation.signal.aborted, false);
          events.push(point === "loop-body-complete" ? "checkpoint" : `checkpoint:${point}`);
        };
        const extension: Extension = {
          name: "checkpoint-consumer",
          runtimeIdentity: published.commandRuntimeIdentity,
          create: () => ({
            checkpoint,
            builtins: [{
              name: "probe",
              execute(invocation) {
                events.push(`body:${invocation.args.join(",")}`);
                return 0;
              },
            }],
          }),
        };
        const fs = createMemoryFileSystem();
        const shell = new published.Shell({
          fs,
          extensions: [extension],
          limits: { maxWallClockMs: 2000, maxOutputBytes: 65536, maxCommands: 128 },
        });
        resources.shell = shell;
        shell.use(published.agentCommands());
        if (route !== "inline") await fs.writeFile("/checkpoints.sh", new TextEncoder().encode(record.source));
        const source = route === "inline" ? record.source : `${route} /checkpoints.sh`;
        const result = await shell.exec(source, { env: { LC_ALL: "C" } });
        assert.equal(result.exitCode, record.status ?? 0, result.stderr);
        assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.alloc(0));
        assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.alloc(0));
        assert.deepEqual(events, record.events);
      });
    }
  }
});
