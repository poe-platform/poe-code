import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { CommandRegistry, createStandardCommands, MemoryFileSystem, pipeBytes, Shell, ShellLimitError } from "../../src/index.js";
import type { ByteSource, ShellLimits } from "../../src/index.js";

export const probeNames = [
  "preaborted-execution-has-no-input-command-or-file-effects",
  "cancel-blocked-input-preserves-reason-and-returns-once",
  "cancel-blocked-output-preserves-reason-and-stops-following-command",
  "cancel-pipeline-reaches-both-command-signals",
  "timer-cancellation-interrupts-busy-shell-loop",
  "early-consumer-closes-infinite-producer-without-late-writes",
  "fragmented-utf8-read-retains-unconsumed-bytes",
  "syntax-error-does-not-acquire-input-or-run-command",
  "max-source-bytes-counts-utf8-before-effects",
  "max-commands-shared-across-pipeline-stages",
  "zero-command-budget-prevents-redirection-side-effects",
  "max-loop-iterations-stops-before-next-side-effect",
  "max-output-combines-stdout-and-stderr",
  "max-output-includes-command-substitution",
  "max-output-includes-file-redirection",
  "max-substitution-depth-stops-before-inner-command",
  "max-expansion-fields-stops-before-command",
  "max-expansion-bytes-stops-before-command",
  "max-expansion-bytes-includes-glob-result-filenames",
  "budget-is-fresh-for-next-exec-after-rejection",
  "tiny-pipe-preserves-binary-byte-order",
  "tiny-pipe-backpressures-producer-until-consumer-reads",
] as const;

export function runtime() {
  const fs = new MemoryFileSystem();
  const commands = new CommandRegistry(createStandardCommands());
  const shell = new Shell({ fs, commands });
  return { fs, commands, shell };
}

export async function runProbe(name: string): Promise<void> {
  const { fs, commands, shell } = runtime();
  let marks = 0;
  commands.register({ name: "mark", async execute(context) {
    marks++;
    await context.fs.writeFile(`/mark-${marks}`, new Uint8Array([marks]), { signal: context.signal });
    return { exitCode: 0 };
  } });
  const controller = new AbortController();
  const reason = new Error(`stress cancellation: ${name}`);
  const rejectsReason = (operation: Promise<unknown>) => assert.rejects(operation, error => error === reason);
  const rejectsLimit = (script: string, limits: ShellLimits, limit: keyof ShellLimits) =>
    assert.rejects(shell.exec(script, { limits }), error => error instanceof ShellLimitError && error.limit === limit);
  try {
    if (name === "preaborted-execution-has-no-input-command-or-file-effects") {
      let acquired = 0;
      const stdin: ByteSource = { [Symbol.asyncIterator]() { acquired++; throw new Error("must not acquire"); } };
      controller.abort(reason);
      await rejectsReason(shell.exec("mark >output", { stdin, signal: controller.signal }));
      assert.equal(acquired, 0);
      assert.equal(marks, 0);
      assert.deepEqual(await fs.readdir("/"), []);
    } else if (name === "cancel-blocked-input-preserves-reason-and-returns-once") {
      let returned = 0;
      let reads = 0;
      const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
        next() { reads++; setTimeout(() => controller.abort(reason), 15); return new Promise(() => {}); },
        async return() { returned++; return { value: undefined, done: true }; },
      }; } };
      await rejectsReason(shell.exec("cat; mark", { stdin, signal: controller.signal }));
      await delay(20);
      assert.equal(reads, 1);
      assert.equal(returned, 1);
      assert.equal(marks, 0);
    } else if (name === "cancel-blocked-output-preserves-reason-and-stops-following-command") {
      let writes = 0;
      await rejectsReason(shell.exec("printf blocked; mark", { signal: controller.signal, stdout: {
        write() { writes++; setTimeout(() => controller.abort(reason), 15); return new Promise(() => {}); },
      } }));
      await delay(20);
      assert.equal(writes, 1);
      assert.equal(marks, 0);
    } else if (name === "cancel-pipeline-reaches-both-command-signals") {
      const entered: string[] = [];
      const observed: string[] = [];
      for (const command of ["left", "right"]) {
        commands.register({ name: command, async execute({ signal }) {
          entered.push(command);
          await new Promise<void>(resolve => {
            signal.addEventListener("abort", () => { observed.push(command); resolve(); }, { once: true });
            if (entered.length === 2) controller.abort(reason);
          });
          return { exitCode: 0 };
        } });
      }
      await rejectsReason(shell.exec("left | right; mark", { signal: controller.signal, limits: { pipeHighWaterMark: 1 } }));
      await delay(20);
      assert.deepEqual(entered.sort(), ["left", "right"]);
      assert.deepEqual(observed.sort(), ["left", "right"]);
      assert.equal(marks, 0);
    } else if (name === "timer-cancellation-interrupts-busy-shell-loop") {
      const timer = setTimeout(() => controller.abort(reason), 20);
      try {
        await rejectsReason(shell.exec("while true; do true; done; mark", {
          signal: controller.signal, limits: { maxCommands: 1_000_000_000, maxLoopIterations: 1_000_000_000 },
        }));
        assert.equal(marks, 0);
      } finally { clearTimeout(timer); }
    } else if (name === "early-consumer-closes-infinite-producer-without-late-writes") {
      let writes = 0;
      let stopped = false;
      commands.register({ name: "produce", async execute({ stdout, signal }) {
        try {
          while (true) { signal.throwIfAborted(); await stdout.write(new Uint8Array([65])); writes++; }
        } finally { stopped = true; }
      } });
      commands.register({ name: "take", async execute({ stdin, stdout }) {
        for await (const chunk of stdin) { await stdout.write(chunk.subarray(0, 1)); break; }
        return { exitCode: 0 };
      } });
      const result = await shell.exec("produce | take; mark", { limits: { pipeHighWaterMark: 1 } });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "A");
      assert.equal(result.stderr, "");
      assert.equal(stopped, true);
      const completedWrites = writes;
      await delay(20);
      assert.equal(writes, completedWrites);
      assert.equal(marks, 1);
    } else if (name === "fragmented-utf8-read-retains-unconsumed-bytes") {
      const bytes = new TextEncoder().encode("é🙂\n終\nrest");
      const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
        for (const byte of bytes) yield new Uint8Array([byte]);
      } };
      const result = await shell.exec('IFS= read -r first; IFS= read -r second; printf "[%s][%s]" "$first" "$second"; cat; cat', { stdin });
      assert.equal(result.stdout, "[é🙂][終]rest");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } else if (name === "syntax-error-does-not-acquire-input-or-run-command") {
      let acquired = 0;
      const stdin: ByteSource = { [Symbol.asyncIterator]() { acquired++; throw new Error("must not acquire"); } };
      const result = await shell.exec("mark >output; true |", { stdin });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.notEqual(result.stderr, "");
      assert.equal(acquired, 0);
      assert.equal(marks, 0);
      assert.deepEqual(await fs.readdir("/"), []);
    } else if (name === "max-source-bytes-counts-utf8-before-effects") {
      const script = "mark #é";
      await rejectsLimit(script, { maxSourceBytes: Buffer.byteLength(script) - 1 }, "maxSourceBytes");
      assert.equal(marks, 0);
      assert.equal((await shell.exec(script, { limits: { maxSourceBytes: Buffer.byteLength(script) } })).exitCode, 0);
      assert.equal(marks, 1);
    } else if (name === "max-commands-shared-across-pipeline-stages") {
      await rejectsLimit("mark; mark | cat; mark", { maxCommands: 3 }, "maxCommands");
      assert.equal(marks, 2);
    } else if (name === "zero-command-budget-prevents-redirection-side-effects") {
      await rejectsLimit("mark >output", { maxCommands: 0 }, "maxCommands");
      assert.equal(marks, 0);
      assert.deepEqual(await fs.readdir("/"), []);
    } else if (name === "max-loop-iterations-stops-before-next-side-effect") {
      await rejectsLimit("for value in a b c d; do mark; done; mark", { maxLoopIterations: 2 }, "maxLoopIterations");
      assert.equal(marks, 2);
    } else if (name === "max-output-combines-stdout-and-stderr") {
      await rejectsLimit("printf 1234; printf 5678 >&2; mark", { maxOutputBytes: 7 }, "maxOutputBytes");
      assert.equal(marks, 0);
    } else if (name === "max-output-includes-command-substitution") {
      await rejectsLimit("value=$(printf 12345678); mark", { maxOutputBytes: 7 }, "maxOutputBytes");
      assert.equal(marks, 0);
    } else if (name === "max-output-includes-file-redirection") {
      await rejectsLimit("printf 12345678 >output; mark", { maxOutputBytes: 7 }, "maxOutputBytes");
      assert.equal(marks, 0);
      assert.equal((await fs.readFile("/output")).byteLength, 0);
    } else if (name === "max-substitution-depth-stops-before-inner-command") {
      await rejectsLimit('value=$(printf "%s" "$(mark)"); mark', { maxSubstitutionDepth: 1 }, "maxSubstitutionDepth");
      assert.equal(marks, 0);
    } else if (name === "max-expansion-fields-stops-before-command") {
      for (const file of ["a", "b", "c", "d"]) await fs.writeFile(`/${file}`, new Uint8Array());
      await rejectsLimit("mark *", { maxExpansionFields: 3 }, "maxExpansionFields");
      assert.equal(marks, 0);
    } else if (name === "max-expansion-bytes-stops-before-command") {
      await rejectsLimit("mark ééé", { maxExpansionBytes: 5 }, "maxExpansionBytes");
      assert.equal(marks, 0);
    } else if (name === "max-expansion-bytes-includes-glob-result-filenames") {
      await fs.writeFile("/sixteen-letters-long", new Uint8Array());
      await rejectsLimit("mark *", { maxExpansionBytes: 8 }, "maxExpansionBytes");
      assert.equal(marks, 0);
    } else if (name === "budget-is-fresh-for-next-exec-after-rejection") {
      await rejectsLimit("printf too-much", { maxOutputBytes: 1 }, "maxOutputBytes");
      const result = await shell.exec("printf ok; mark", { limits: { maxOutputBytes: 2 } });
      assert.equal(result.stdout, "ok");
      assert.equal(result.exitCode, 0);
      assert.equal(marks, 1);
    } else if (name === "tiny-pipe-preserves-binary-byte-order") {
      const bytes = Uint8Array.from({ length: 4096 }, (_, index) => (index * 37 + 11) % 256);
      commands.register({ name: "binary", async execute({ stdout }) {
        for (let offset = 0; offset < bytes.length; offset += 17) await stdout.write(bytes.subarray(offset, offset + 17));
        return { exitCode: 0 };
      } });
      const result = await shell.exec("binary | cat | cat", { limits: { pipeHighWaterMark: 1 } });
      assert.deepEqual(result.stdoutBytes, bytes);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } else if (name === "tiny-pipe-backpressures-producer-until-consumer-reads") {
      let completedWrites = 0;
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      commands.register({ name: "produce", async execute({ stdout }) {
        for (let index = 0; index < 32; index++) {
          await stdout.write(new Uint8Array([65]));
          completedWrites++;
        }
        return { exitCode: 0 };
      } });
      commands.register({ name: "slowcat", async execute({ stdin, stdout, signal }) {
        await gate;
        await pipeBytes(stdin, stdout, signal);
        return { exitCode: 0 };
      } });
      const operation = shell.exec("produce | slowcat", { limits: { pipeHighWaterMark: 1 } });
      await delay(20);
      const beforeRelease = completedWrites;
      release();
      const result = await operation;
      assert.ok(beforeRelease <= 1, `${beforeRelease} writes completed before the consumer read`);
      assert.equal(completedWrites, 32);
      assert.equal(result.stdout, "A".repeat(32));
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } else throw new Error(`Unknown stress probe: ${name}`);
  } finally { await shell.dispose(); }
}
