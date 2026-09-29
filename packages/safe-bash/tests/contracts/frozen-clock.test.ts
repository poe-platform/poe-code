import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type CommandDefinition } from "../../src/contracts/index.js";
import { createDdCommand } from "../../../safe-bash-command-dd/src/index.js";
import { createFmtCommands } from "../../../safe-bash-command-fmt/src/index.js";
import { createNumfmtCommand } from "../../../safe-bash-command-numfmt/src/index.js";
import { createPrCommands } from "../../../safe-bash-command-pr/src/index.js";
import { createTsortCommand } from "../../../safe-bash-command-tsort/src/index.js";
import { createHtmlToMarkdownCommand } from "../../../safe-bash-command-html-to-markdown/src/index.js";
import { createIconvCommand } from "../../../safe-bash-command-iconv/src/index.js";
import { createShufCommands } from "../../../safe-bash-command-shuf/src/index.js";
import { SharedBudget, settings as fileSettings } from "../../../safe-bash-command-file/src/shared.js";
import { Budget as DiffBudget } from "../../src/commands/diff-patch/shared.js";
import { Budget as SplitBudget } from "../../../safe-bash-command-split/src/io.js";
import { settings as splitSettings } from "../../../safe-bash-command-split/src/options.js";
import { Budget as DuBudget } from "../../../safe-bash-command-du/src/budget.js";
import { settings as duSettings } from "../../../safe-bash-command-du/src/options.js";
import { WalkBudget } from "../../../safe-bash-command-tree/src/io.js";
import { settings as treeSettings } from "../../../safe-bash-command-tree/src/options.js";
import { stringCheckpoint } from "../../../safe-bash-io-engine/src/shell/string-operations.js";

const cases: [string, () => CommandDefinition, string[], string][] = [
  ["dd", createDdCommand, ["if=/input", "of=/output", "bs=16", "status=none"], "abc\n".repeat(256)],
  ["fmt", () => createFmtCommands()[0]!, ["-w", "10", "/input"], "one two three four five six\n".repeat(32768)],
  ["numfmt", createNumfmtCommand, ["--field=2", "--to=iec"], "a 1024\n".repeat(8192)],
  ["numfmt", createNumfmtCommand, ["--to=iec", `--field=${Array.from({ length: 1024 }, (_, i) => i * 2 + 1).join(",")}`], "1024 2048\n".repeat(32)],
  ["pr", () => createPrCommands()[0]!, ["-l", "20", "/input"], "abc\n".repeat(8192)],
  ["tsort", createTsortCommand, ["/input"], Array.from({ length: 8192 }, (_, i) => `n${i} n${i + 1}\n`).join("")],
  ["html-to-markdown", createHtmlToMarkdownCommand, ["/input"], "<p>hello world</p>".repeat(8192)],
  ["iconv", createIconvCommand, ["-f", "UTF-8", "-t", "UTF-16LE", "/input"], "hello world\n".repeat(8192)],
  ["shuf", () => createShufCommands()[0]!, ["/input"], "abc\n".repeat(65536)],
  ["shuf", () => createShufCommands()[0]!, ["-n", "8", "/input"], "abc\n".repeat(65536)],
  ["shuf", () => createShufCommands()[0]!, ["-i", "1-65536"], ""],
  ["shuf", () => createShufCommands()[0]!, ["-i", "1-32768", "-o", "/output"], ""],
  ["shuf", () => createShufCommands()[0]!, ["-r", "-n", "65536", "/input"], "abc\n"],
];

for (const [name, factory, args, input] of cases) {
  test(`${name} ${args.map(argument => argument.length > 80 ? `${argument.slice(0, 80)}…` : argument).join(" ")} repeatedly yields host turns with a frozen Worker clock`, async t => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", new TextEncoder().encode(input));
    if (name === "shuf" && args.includes("8")) {
      // Select the large-file reservoir path without allocating a huge fixture.
      const stat = fs.stat.bind(fs);
      t.mock.method(fs, "stat", async (...args: Parameters<typeof fs.stat>) => ({ ...await stat(...args), size: 9 * 1024 * 1024 }));
    }
    t.mock.method(performance, "now", () => 0);
    t.mock.method(Date, "now", () => 0);
    const immediate = globalThis.setImmediate;
    Object.defineProperty(globalThis, "setImmediate", { value: undefined, configurable: true, writable: true });
    t.after(() => Object.defineProperty(globalThis, "setImmediate", { value: immediate, configurable: true, writable: true }));
    const timeout = globalThis.setTimeout;
    let turns = 0;
    t.mock.method(globalThis, "setTimeout", (callback: () => void, delay?: number) => timeout(() => { turns++; callback(); }, delay));
    const result = await factory().execute({
      command: name, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () { yield new TextEncoder().encode(input); })(), stdout: { async write() {} }, stderr: { async write() {} },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0);
    assert.ok(turns >= 2, `${name} yielded only ${turns} host turns`);
  });
}

test("string expansion admits timer cancellation after its first frozen-clock turn", async t => {
  t.mock.method(performance, "now", () => 0);
  t.mock.method(Date, "now", () => 0);
  const immediate = globalThis.setImmediate;
  Object.defineProperty(globalThis, "setImmediate", { value: undefined, configurable: true, writable: true });
  t.after(() => Object.defineProperty(globalThis, "setImmediate", { value: immediate, configurable: true, writable: true }));
  const controller = new AbortController();
  const work = { remaining: Infinity, signal: controller.signal, exhausted(): never { throw new Error("budget"); } };
  await stringCheckpoint(work, 128);
  const reason = new Error("timer cancellation");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(async () => {
      for (let i = 0; i < 8192; i++) {
        const pending = stringCheckpoint(work);
        if (pending) await pending;
      }
    }, error => error === reason);
  } finally { clearTimeout(timer); }
});

for (const name of ["file", "diff-patch", "split", "du", "tree"]) {
  test(`${name} work checkpoints repeatedly yield with a frozen clock`, async t => {
    t.mock.method(performance, "now", () => 0);
    t.mock.method(Date, "now", () => 0);
    const immediate = globalThis.setImmediate;
    Object.defineProperty(globalThis, "setImmediate", { value: undefined, configurable: true, writable: true });
    t.after(() => Object.defineProperty(globalThis, "setImmediate", { value: immediate, configurable: true, writable: true }));
    const timeout = globalThis.setTimeout;
    let turns = 0;
    t.mock.method(globalThis, "setTimeout", (callback: () => void, delay?: number) => timeout(() => { turns++; callback(); }, delay));
    const context = {
      command: name, args: createCommandArguments([]).args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal,
    };
    if (name === "file") {
      const budget = new SharedBudget(context, fileSettings({}));
      try { for (let i = 0; i < 4096; i++) await budget.step(); } finally { budget.dispose(); }
    } else if (name === "diff-patch") {
      const budget = new DiffBudget(context, {});
      for (let i = 0; i < 32; i++) { budget.step(4096); await budget.checkpoint(); }
    } else if (name === "split") {
      const budget = new SplitBudget(splitSettings({}), context.signal);
      for (let i = 0; i < 32; i++) await budget.step(65536);
    } else if (name === "du") {
      const budget = new DuBudget(context, duSettings({}));
      for (let i = 0; i < 2048; i++) await budget.fs(async () => 1);
    } else {
      const budget = new WalkBudget(context, treeSettings({}));
      for (let i = 0; i < 2048; i++) await budget.fs(async () => 1);
    }
    assert.ok(turns >= 2, `${name} yielded only ${turns} host turns`);
  });
}
