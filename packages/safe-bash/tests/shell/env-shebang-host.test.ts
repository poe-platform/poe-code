import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const author = join(root, "tests/shell-stress/env-shebang-author");

function settled(result: SpawnSyncReturns<Buffer>): void {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr.toString());
  if (result.pid) assert.throws(() => process.kill(result.pid, 0), error => (error as NodeJS.ErrnoException).code === "ESRCH");
}

async function probe(scenario: string): Promise<void> {
  const { shell, fs, commands } = setup();
  const controller = new AbortController();
  const reason = Object.assign(new Error("env shebang caller abort"), { code: "ENOENT" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => { timer = setTimeout(() => controller.abort(reason), 10); };
  await fs.writeFile("/program", Buffer.from("#!/usr/bin/env -S bash\nblock"), { mode: 0o755 });
  try {
    if (scenario === "recursive-depth") {
      await fs.writeFile("/program", Buffer.from("#!/usr/bin/env -S bash\n/program"));
      await assert.rejects(shell.exec("/program", { limits: { maxSubstitutionDepth: 4 } }), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
    } else if (scenario === "preabort") {
      controller.abort(reason);
      let reads = 0;
      fs.readFile = async () => { reads++; throw new Error("unexpected source read"); };
      await assert.rejects(shell.exec("/program", { signal: controller.signal }), error => error === reason);
      assert.equal(reads, 0);
    } else if (scenario === "parser-cancel") {
      await fs.writeFile("/program", Buffer.from(`#!/usr/bin/env -S bash ${"x".repeat(100000)}\nblock`));
      let callback: ReturnType<typeof setImmediate> | undefined;
      const readFile = fs.readFile.bind(fs);
      fs.readFile = async (...args) => {
        const bytes = await readFile(...args);
        callback = setImmediate(() => controller.abort(reason));
        return bytes;
      };
      try { await assert.rejects(shell.exec("/program", { signal: controller.signal }), error => error === reason); }
      finally { if (callback) clearImmediate(callback); }
    } else if (scenario === "cwd-late-rejection") {
      await fs.writeFile("/program", Buffer.from("#!/usr/bin/env -S -C /blocked bash\nblock"));
      const stat = fs.stat.bind(fs);
      let late = false;
      fs.stat = async (path, options) => {
        if (path !== "/blocked") return stat(path, options);
        assert.ok(options?.signal);
        arm();
        await delay(40);
        late = true;
        throw new Error("late cwd failure");
      };
      await assert.rejects(shell.exec("/program", { signal: controller.signal }), error => error === reason);
      await delay(60);
      assert.equal(late, true);
    } else if (scenario === "input-cancel") {
      await fs.writeFile("/program", Buffer.from("#!/usr/bin/env -S bash -s\nblock"));
      let returned = false;
      let rejectRead: ((reason: unknown) => void) | undefined;
      const stdin = { [Symbol.asyncIterator]() { return {
        next() { arm(); return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => { rejectRead = reject; }); },
        async return() { returned = true; rejectRead?.(new Error("late input failure")); return { done: true as const, value: undefined }; },
      }; } };
      await assert.rejects(shell.exec("/program", { signal: controller.signal, stdin }), error => error === reason);
      assert.equal(returned, true);
    } else if (scenario === "sink-cancel") {
      await fs.writeFile("/program", Buffer.from("#!/usr/bin/env -S bash\nsay payload"));
      commands.register({ name: "bridge", execute(context) {
        return context.invoke!("/program", [], { stdout: { async write() { arm(); await delay(40); throw new Error("late sink failure"); } } });
      } });
      await assert.rejects(shell.exec("bridge", { signal: controller.signal }), error => error === reason);
      await delay(60);
    } else if (scenario === "cleanup" || scenario === "cleanup-failure") {
      let closed = 0;
      let pending: Promise<void> | undefined;
      let rejectWork: ((reason: unknown) => void) | undefined;
      const cleanupFailure = new Error("registered cleanup failure");
      commands.register({ name: "block", async execute(context) {
        const cleanup = () => pending ??= delay(25).then(() => {
          closed++;
          rejectWork?.(new Error("late command failure"));
          if (scenario === "cleanup-failure") throw cleanupFailure;
        });
        context.registerCleanup!(cleanup);
        if (scenario === "cleanup-failure") return { exitCode: 0 };
        arm();
        try { return await new Promise<never>((_resolve, reject) => { rejectWork = reject; }); }
        finally { await cleanup(); }
      } });
      await assert.rejects(shell.exec("/program", { signal: controller.signal }), error => error === (scenario === "cleanup" ? reason : cleanupFailure));
      assert.equal(closed, 1);
      await delay(20);
    } else throw new Error(`Unknown probe: ${scenario}`);
  } finally {
    if (timer) clearTimeout(timer);
    await shell.dispose();
  }
}

async function guardedProbe(scenario: string): Promise<void> {
  const { shell, fs, commands } = setup();
  const controller = new AbortController();
  const reason = Object.assign(new Error("guarded caller reason"), { code: "ENOENT" });
  const cleanupFailure = new Error("guarded cooperative cleanup failure");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleaned = 0;
  let entered = 0;
  let cleanup: Promise<void> | undefined;
  let rejectWork: ((error: unknown) => void) | undefined;
  let retained: (() => Promise<unknown>) | undefined;
  const close = () => cleanup ??= delay(15).then(() => {
    cleaned++;
    rejectWork?.(new Error("observed late rejection"));
    if (scenario.endsWith("cleanup-failure")) throw cleanupFailure;
  });
  const block = async (context: import("../../src/index.js").CommandContext) => {
    context.registerCleanup!(close);
    retained = () => context.invoke!("unexpected", []);
    if (scenario.endsWith("cleanup-failure") || scenario === "closed-admission") return { exitCode: 0 };
    timer = setTimeout(() => controller.abort(reason), 10);
    if (scenario === "opaque-env" || scenario === "opaque-target") return new Promise<never>(() => {});
    try { return await new Promise<never>((_resolve, reject) => { rejectWork = reject; }); }
    finally { await close(); }
  };
  commands.register({ name: "probe", async execute(context) { entered++; return block(context); } });
  commands.register({ name: "unexpected", execute() { throw new Error("closed invocation admitted work"); } });
  shell.use(async (context, next) => {
    if (context.command === "env" && ["env-cancel", "env-cleanup-failure", "opaque-env"].includes(scenario)) return block(context);
    if (context.command === "probe" && scenario === "target-middleware-cancel") return block(context);
    return next();
  });
  await fs.writeFile("/program", Buffer.from("#!/usr/bin/env -S -i probe\nsay BAD"), { mode: 0o755 });
  try {
    if (scenario === "closed-admission") {
      assert.equal((await shell.exec("/program")).exitCode, 0);
      await assert.rejects(retained!(), /Invocation is closed/u);
    } else {
      await assert.rejects(shell.exec("/program", { signal: controller.signal }), error => error === (scenario.endsWith("cleanup-failure") ? cleanupFailure : reason));
    }
    assert.equal(cleaned, 1);
    assert.equal(entered, ["env-cancel", "env-cleanup-failure", "opaque-env", "target-middleware-cancel"].includes(scenario) ? 0 : 1);
    await delay(20);
  } finally {
    if (timer) clearTimeout(timer);
    await shell.dispose();
  }
}

if (process.argv[2]?.startsWith("guarded:")) {
  await guardedProbe(process.argv[2].slice(8));
  console.log("passed");
} else if (process.argv[2]?.startsWith("probe:")) {
  await probe(process.argv[2].slice(6));
  console.log("passed");
} else {
  for (const scenario of ["env-cancel", "target-cancel", "env-cleanup-failure", "target-cleanup-failure", "opaque-env", "opaque-target", "closed-admission", "target-middleware-cancel"]) {
    test(`guarded completion bounded host: ${scenario}`, { timeout: 5000 }, () => {
      const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(import.meta.url), `guarded:${scenario}`], {
        timeout: 3500, killSignal: "SIGKILL", maxBuffer: 256 * 1024,
      });
      settled(child);
      assert.equal(child.status, 0, child.stderr.toString());
      assert.equal(child.stdout.toString(), "passed\n");
    });
  }

  for (const scenario of ["recursive-depth", "preabort", "parser-cancel", "cwd-late-rejection", "input-cancel", "sink-cancel", "cleanup", "cleanup-failure"]) {
    test(`env shebang bounded host: ${scenario}`, { timeout: 5000 }, () => {
      const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(import.meta.url), `probe:${scenario}`], {
        timeout: 3500, killSignal: "SIGKILL", maxBuffer: 256 * 1024,
      });
      settled(child);
      assert.equal(child.status, 0, child.stderr.toString());
      assert.equal(child.stdout.toString(), "passed\n");
    });
  }

  test("env shebang moved built public-package consumer", { timeout: 10000 }, async () => {
    await mkdir(author, { recursive: true });
    const scratch = await mkdtemp(join(author, ".consumer-"));
    try {
      const destination = join(scratch, "node_modules/virtual-bash");
      await mkdir(destination, { recursive: true });
      await cp(join(root, "dist"), join(destination, "dist"), { recursive: true });
      await cp(join(root, "package.json"), join(destination, "package.json"));
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import assert from 'node:assert/strict';
        import { Shell, createMemoryFileSystem, agentCommands } from 'virtual-bash';
        const fs = createMemoryFileSystem();
        await fs.writeFile('/program', Buffer.from('#!/usr/bin/env -S -i V=ok bash\\nprintf "%s:%s" "$V" "$1"'), { mode: 0o755 });
        const shell = new Shell({ fs }).use(agentCommands());
        try {
          const result = await shell.exec('/program "literal space"');
          assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
          assert.equal(result.stdout, 'ok:literal space');
        } finally { await shell.dispose(); }
      `], { cwd: scratch, timeout: 4000, killSignal: "SIGKILL", maxBuffer: 256 * 1024 });
      settled(child);
      assert.equal(child.status, 0, child.stderr.toString());
    } finally { await rm(scratch, { recursive: true, force: true }); }
  });

}
