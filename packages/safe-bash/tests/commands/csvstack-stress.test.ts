import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "@poe-code/csvkit";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec], locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

async function check(command: string, files: Readonly<Record<string, string>>, stdin: string, stdout: string, stderr = "", status = 0): Promise<void> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [path, content] of Object.entries(files)) await fs.writeFile(`/work/${path}`, new TextEncoder().encode(content));
  const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
  try {
    const result = await shell.exec(command, { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout, stderr, status });
    for (const [path, content] of Object.entries(files)) assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${path}`)), content);
  } finally { await shell.dispose(); }
}

test("csvstack stress: dictionary union preserves first appearance and never infers lexical cells", async () => {
  await check("csvstack one.csv two.csv three.csv", {
    "one.csv": "b,a\n002,true\n",
    "two.csv": "c,b\n2024-01-01,0001\n",
    "three.csv": "d,a,c\n9007199254740993,no,3.00\n"
  }, "", "b,a,c,d\n002,true,,\n0001,,2024-01-01,\n,no,3.00,9007199254740993\n");
});

test("csvstack stress: duplicate and empty header keys retain DictReader replacement semantics", async () => {
  await check("csvstack one.csv two.csv", {
    "one.csv": "a,a,,b\nfirst,last,blank,bee\nshort\n",
    "two.csv": "b,,a\nb2,blank2,a2\n"
  }, "", "a,,b\nlast,blank,bee\n,,\na2,blank2,b2\n");
});

test("csvstack stress: group-column collision writes the group twice and drops input values", async () => {
  await check("csvstack -g X -n a", {}, "a,b,a\n1,2,3\n", "a,a,b\nX,X,2\n");
  await check("csvstack -n renamed", {}, "a\nx\n", "a\nx\n");
});

test("csvstack stress: dictionary line numbers replace every colliding input or group key", async () => {
  await check("csvstack -l", {}, "line_number,a\ninput,x\nother,y\n", "line_number,line_number,a\n1,1,x\n2,2,y\n");
  await check("csvstack -l -g X -n line_number", {}, "a\nx\ny\n", "line_number,line_number,a\n1,1,x\n2,2,y\n");
  await check("csvstack -l -g X -n line_number", {}, "line_number,a\ninput,x\n", "line_number,line_number,line_number,a\n1,1,1,x\n");
  // Positional writers prepend line numbers without dictionary key replacement.
  await check("csvstack -H -l -g X -n line_number", {}, "input,x\nother,y\n", "line_number,line_number,a,b\n1,input,x\n2,X,other,y\n");
});

test("csvstack stress: no-header first width does not constrain or reorder later rows", async () => {
  await check("csvstack -H -g first,second -l first.csv second.csv", {
    "first.csv": "1,02\n3\n", "second.csv": "4,05,6\n\n7,08\n"
  }, "", "line_number,group,a,b\n1,first,1,02\n2,first,3\n3,second,4,05,6\n4,second\n5,second,7,08\n");
});

test("csvstack stress: cached stdin first row has no grouping cell and counts as an output row", async () => {
  await check("csvstack -H -g first -l", {}, "a,b\nc,d\n", "line_number,group,a,b\n1,a,b\n2,first,c,d\n");
  await check("csvstack -H --filenames", {}, "a,b\nc,d\n", "group,a,b\na,b\n<stdin>,c,d\n");
});

test("csvstack stress: repeated stdin exposes different first-pass and second-pass errors", async () => {
  await check("csvstack - -", {}, "a,b\n1,2\n", "", "UnsupportedOperation: It is not possible to set the encoding or newline of stream after the first read\n", 1);
  await check("csvstack -H -g first,second - -", {}, "a,b\nc,d\n", "group,a,b\na,b\nfirst,c,d\n", "ValueError: I/O operation on closed file.\n", 1);
});

test("csvstack stress: per-file physical skipping respects multiline quoted records", async () => {
  await check("csvstack -K 1 -g A,B -l first.csv second.csv", {
    "first.csv": "discard\na,b\n\"x\ny\",1\n", "second.csv": "discard\nb,a\n2,z\n"
  }, "", 'line_number,group,a,b\n1,A,"x\ny",1\n2,B,z,2\n');
  // No-header preflight only examines the first file, so later stdin is not skipped.
  await check("csvstack -K 1 -H first.csv -", { "first.csv": "discard\na,b\n" }, "discard\nx,y\n", "a,b\na,b\ndiscard\nx,y\n");
});

test("csvstack stress: filenames override even mismatched groups and use each basename", async () => {
  await check("csvstack --filenames -g ignored -n origin one.csv two.csv", {
    "one.csv": "a\n1\n", "two.csv": "a\n2\n"
  }, "", "origin,a\none.csv,1\ntwo.csv,2\n");
});

test("csvstack stress: extra dictionary fields retain already-written rows and union header", async () => {
  await check("csvstack first.csv second.csv", {
    "first.csv": "a\nokay\nextra,field\n", "second.csv": "b\nlater\n"
  }, "", "a,b\nokay,\n", "ValueError: dict contains fields not in fieldnames: None\n", 1);
});

test("csvstack stress: reopen failure happens after union header and preceding file rows", async () => {
  const fs = new MemoryFileSystem();
  const events: string[] = [];
  const opens = new Map<string, number>();
  Object.assign(fs, {
    async readFile() { assert.fail("stream-capable VFS must not bulk-read"); },
    readStream(path: string) {
      const attempt = (opens.get(path) ?? 0) + 1;
      opens.set(path, attempt);
      events.push(`open:${path}:${attempt}`);
      return { [Symbol.asyncIterator]() {
        let yielded = false;
        return {
          async next() {
            if (path === "/work/two.csv" && attempt === 2) throw Object.assign(new Error("reopen denied"), { code: "EACCES" });
            if (yielded) return { done: true as const, value: undefined };
            yielded = true;
            return { done: false as const, value: new TextEncoder().encode(path.endsWith("one.csv") ? "a\nfirst\n" : "b\nsecond\n") };
          },
          async return() { events.push(`close:${path}:${attempt}`); return { done: true as const, value: undefined }; }
        };
      } };
    }
  });
  const shell = new Shell({ fs, cwd: "/work" }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvstack one.csv two.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "a,b\nfirst,\n", stderr: "PermissionError: [Errno 13] Permission denied: 'two.csv'\n", status: 1
    });
    assert.deepEqual(events, ["open:/work/one.csv:1", "close:/work/one.csv:1", "open:/work/two.csv:1", "close:/work/two.csv:1", "open:/work/one.csv:2", "close:/work/one.csv:2", "open:/work/two.csv:2", "close:/work/two.csv:2"]);
  } finally { await shell.dispose(); }
});

test("csvstack stress: first-pass close failure prevents union output and later acquisitions", async () => {
  const fs = new MemoryFileSystem();
  let returned = 0;
  Object.assign(fs, {
    readStream(path: string) {
      assert.equal(path, "/one.csv");
      return { [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false as const, value: new TextEncoder().encode("a\nx\n") }),
        return: async () => { returned++; throw Object.assign(new Error("close denied"), { code: "EACCES" }); }
      }) };
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvstack one.csv two.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "PermissionError: [Errno 13] Permission denied: 'one.csv'\n", status: 1
    });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});

test("csvstack stress: mutable stdin byte views survive cached row replay and producer cleanup", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let returned = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    const storage = new Uint8Array(64);
    try {
      for (const fragment of ["001,true\n", "002,false\n", "003,null\n"]) {
        const bytes = new TextEncoder().encode(fragment);
        storage.set(bytes);
        yield storage.subarray(0, bytes.length);
        storage.fill(120);
      }
    } finally { returned++; storage.fill(121); }
  } };
  try {
    const result = await shell.exec("csvstack -H -g chosen -l --add-bom", { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "\ufeffline_number,group,a,b\n1,001,true\n2,chosen,002,false\n3,chosen,003,null\n", stderr: "", status: 0
    });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
});

test("csvstack stress: cancellation during header acquisition returns cooperative named input", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => { resolve({ done: true, value: undefined }); };
  });
  let returned = 0;
  Object.assign(fs, {
    readStream(path: string) {
      assert.equal(path, "/pending.csv");
      return { [Symbol.asyncIterator]: () => ({
        next: () => { started(); return pending; },
        return: async () => { returned++; release(); return { done: true, value: undefined }; }
      }) };
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const execution = shell.exec("csvstack pending.csv", {
    signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() { assert.fail("named input must not acquire stdin"); yield new Uint8Array(); } }
  });
  const rejection = assert.rejects(execution, reason => reason === false);
  try {
    await admitted;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(returned, 1);
    await rejection;
  } finally {
    release();
    await rejection;
    await shell.dispose();
  }
});

test("csvstack stress: accepted but unqualified numeric and nullable quoting modes remain explicit blockers", async () => {
  for (const mode of [2, 4, 5]) {
    await check(`csvstack -u ${mode}`, {}, '"a","b"\n1,\n', "a,b\n", `csvkit: unsupported or unqualified: input quoting mode ${mode} numeric/null operation cells\n`, 78);
  }
});

test("csvstack stress: cancellation also closes a pending second-pass reopen", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => { resolve({ done: true, value: undefined }); };
  });
  let opens = 0;
  let returned = 0;
  Object.assign(fs, {
    readStream(path: string) {
      assert.equal(path, "/pending.csv");
      const attempt = ++opens;
      return { [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (attempt === 1) return { done: false as const, value: new TextEncoder().encode("a\nx\n") };
          started();
          return pending;
        },
        return: async () => { returned++; if (attempt === 2) release(); return { done: true, value: undefined }; }
      }) };
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const execution = shell.exec("csvstack pending.csv", { signal: controller.signal });
  const rejection = assert.rejects(execution, reason => reason === null);
  try {
    await admitted;
    controller.abort(null);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(opens, 2);
    assert.equal(returned, 2);
    await rejection;
  } finally {
    release();
    await rejection;
    await shell.dispose();
  }
});
