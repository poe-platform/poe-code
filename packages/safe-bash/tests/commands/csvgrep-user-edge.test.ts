import test from "node:test";
import assert from "node:assert/strict";
import { commands, utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected inference"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("csvgrep user repeated file options acquire every handle but read only the last", async () => {
  const events: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile(path) {
      events.push(`open:${path}`);
      return { async *lines() { events.push(`read:${path}`); yield path; }, async close() { events.push(`close:${path}`); } };
    }
  }));
  try {
    const result = await shell.exec("csvgrep -c a -f first -f second", { stdin: "a\nfirst\nsecond\n" });
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "a\nsecond\n", ""]);
    assert.deepEqual(events, ["open:first", "open:second", "read:second", "close:second", "close:first"]);
  } finally { await shell.dispose(); }
});

test("csvgrep user truthy regex wins over file and string while empty regex falls through", async () => {
  const events: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile() {
      events.push("open");
      return { async *lines() { events.push("read"); yield "file"; }, async close() { events.push("close"); } };
    }
  }));
  try {
    for (const [flags, expected, reads] of [
      ["-m string -f matches -r '^regex$'", "a\nregex\n", false],
      ["-r '' -m string -f matches", "a\nfile\n", true],
      ["-m '' -r '^regex$' -f matches", "a\nregex\n", false]
    ] as const) {
      events.length = 0;
      const result = await shell.exec(`csvgrep -c a ${flags}`, { stdin: "a\nregex\nfile\nstring\n" });
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, expected, ""]);
      assert.deepEqual(events, reads ? ["open", "read", "close"] : ["open", "close"]);
    }
  } finally { await shell.dispose(); }
});

test("csvgrep user help and version short circuit later opens but preserve earlier opens", async () => {
  const events: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile() {
      events.push("open");
      return { async *lines() { assert.fail("early exit read match file"); yield ""; }, async close() { events.push("close"); } };
    }
  }));
  try {
    for (const [flag, expected] of [["--help", commands.find(command => command.name === "csvgrep")!.help], ["--version", "csvgrep 2.2.0\n"]]) {
      for (const before of [false, true]) {
        events.length = 0;
        const result = await shell.exec(before ? `csvgrep -f matches ${flag}` : `csvgrep ${flag} -f matches`);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, expected, ""]);
        assert.deepEqual(events, before ? ["open", "close"] : []);
      }
    }
  } finally { await shell.dispose(); }
});

test("csvgrep user missing cells match regex empty anchors and selected column duplicates collapse", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [flags, expected] of [
      ["-c b,b -r '^$'", "a,b\nx\nw,\n"],
      ["-c b,b -r '^$' -i", "a,b\ny,z\n"],
      ["-c a,b -r '^$' -a", "a,b\nx\nw,\n"],
      ["-c a,b -r '^$'", "a,b\n"]
    ]) {
      const result = await shell.exec(`csvgrep ${flags}`, { stdin: "a,b\nx\ny,z\nw,\n" });
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, expected, ""]);
    }
  } finally { await shell.dispose(); }
});

test("csvgrep user names eager failure reports parser error without acquiring stdin", async () => {
  let acquired = false;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile() { throw new Error("denied"); }
  }));
  try {
    const result = await shell.exec("csvgrep -n -f missing", {
      stdin: { async *[Symbol.asyncIterator]() { acquired = true; yield new TextEncoder().encode("a\nx\n"); } }
    });
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [2, "", commands.find(command => command.name === "csvgrep")!.usage + "csvgrep: error: argument -f/--file: can't open 'missing': denied\n"]);
    assert.equal(acquired, false);
  } finally { await shell.dispose(); }
});

test("csvgrep user cancellation during admitted match-file acquisition awaits handle close", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel match-file acquisition");
  const events: string[] = [];
  let opened!: () => void;
  const admission = new Promise<void>(resolve => { opened = resolve; });
  let finishClose!: () => void;
  const closing = new Promise<void>(resolve => { finishClose = resolve; });
  let closeEntered!: () => void;
  const closeStarted = new Promise<void>(resolve => { closeEntered = resolve; });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile(_path, settings) {
      events.push("open");
      const aborted = new Promise<void>(resolve => { settings.signal.addEventListener("abort", () => { resolve(); }, { once: true }); });
      opened();
      await aborted;
      return {
        async *lines() { assert.fail("cancelled invocation read match file"); yield ""; },
        async close() { events.push("close:start"); closeEntered(); await closing; events.push("close:end"); }
      };
    }
  }));
  try {
    let settled = false;
    const execution = shell.exec("csvgrep -n -f matches", { signal: controller.signal }).finally(() => { settled = true; });
    const rejection = assert.rejects(execution, failure => failure === reason);
    await admission;
    controller.abort(reason);
    await closeStarted;
    assert.equal(settled, false);
    assert.deepEqual(events, ["open", "close:start"]);
    finishClose();
    await rejection;
    assert.deepEqual(events, ["open", "close:start", "close:end"]);
  } finally { finishClose(); await shell.dispose(); }
});
