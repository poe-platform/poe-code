import assert from "node:assert/strict";

type API = typeof import("../index.js");
export const hostIds = ["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08"] as const;
export type HostId = typeof hostIds[number];

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; } catch (reason) { return reason; }
  assert.fail("Expected rejection");
}

export async function runHost(id: HostId, api: API): Promise<void> {
  const shell = new api.Shell({ fs: new api.MemoryFileSystem() });
  shell.use(api.agentCommands());
  try {
    if (id === "H01") {
      let cleaned = 0;
      let after = 0;
      shell.register({ name: "cleanup-fault", execute(context) {
        if (!context.registerCleanup) throw new Error("Missing public cleanup capability");
        context.registerCleanup(() => { cleaned++; throw false; });
        return { exitCode: 0 };
      } });
      shell.register({ name: "after", execute() { after++; return { exitCode: 0 }; } });
      assert.equal(await rejection(shell.exec("false; cleanup-fault; after")), false);
      assert.equal(cleaned, 1);
      assert.equal(after, 0);
    } else if (id === "H02") {
      const controller = new AbortController();
      const executionReason = Object.freeze({ role: "execution" });
      let cleaned = 0;
      shell.register({ name: "abort-fault", execute(context) {
        if (!context.registerCleanup) throw new Error("Missing public cleanup capability");
        context.registerCleanup(() => { cleaned++; throw false; });
        controller.abort(0);
        throw executionReason;
      } });
      assert.equal(await rejection(shell.exec("abort-fault", { signal: controller.signal })), 0);
      assert.equal(cleaned, 1);
    } else if (id === "H03") {
      let observed: unknown;
      let invoked = 0;
      shell.register({ name: "bridge", execute(context) {
        if (!context.invoke) throw new Error("Missing public invoke capability");
        invoked++;
        const exact = context.invoke("true", []);
        void exact.then(() => undefined, reason => { observed = reason; });
        return exact;
      } });
      const reason = await rejection(shell.exec("bridge", { limits: { maxCommands: 1 } }));
      assert(reason instanceof api.ShellLimitError);
      assert.equal(reason.limit, "maxCommands");
      assert.equal(reason, observed);
      assert.equal(invoked, 1);
    } else if (id === "H04") {
      let entered = 0;
      shell.register({ name: "probe", execute() { entered++; return { exitCode: 0 }; } });
      const reason = await rejection(shell.exec("probe aa", { limits: { maxExpansionBytes: 1 } }));
      assert(reason instanceof api.ShellLimitError);
      assert.equal(reason.limit, "maxExpansionBytes");
      assert.equal(entered, 0);
    } else if (id === "H05") {
      shell.register({ name: "emit", async execute(context) {
        await context.stdout.write(new Uint8Array([97, 98]));
        return { exitCode: 0 };
      } });
      const reason = await rejection(shell.exec("emit", { limits: { maxOutputBytes: 1 } }));
      assert(reason instanceof api.ShellLimitError);
      assert.equal(reason.limit, "maxOutputBytes");
    } else if (id === "H06") {
      let writes = 0;
      const reason = await rejection(shell.exec('set -u; : "$missing"', {
        stderr: { async write() { writes++; throw false; } },
      }));
      assert.equal(reason, false);
      assert.equal(writes, 1);
    } else if (id === "H07") {
      const result = await shell.exec("set -e; false; printf unreachable");
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    } else {
      for (let iteration = 0; iteration < 2; iteration++) {
        const result = await shell.exec("true", { limits: { maxCommands: 1 } });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }
    }
  } finally { await shell.dispose(); }
}

export async function runVisibleCases(
  api: API,
  cases: readonly { readonly id: string; readonly script: string; readonly stdout: string; readonly exitCode: number }[],
): Promise<readonly string[]> {
  const shell = new api.Shell({ fs: new api.MemoryFileSystem() });
  shell.use(api.agentCommands());
  const completed: string[] = [];
  try {
    for (const row of cases) {
      const result = await shell.exec(row.script);
      assert.equal(result.exitCode, row.exitCode, row.id);
      assert.equal(result.stdout, row.stdout, row.id);
      assert.equal(result.stderr, "", row.id);
      completed.push(row.id);
    }
    return completed;
  } finally { await shell.dispose(); }
}
