import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import reference from "../../../../docs/csvkit/additional-operation-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("csvclean stress reproduces frozen released executable outputs through safe-bash", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const item of reference.cases.filter(item => item.command === "csvclean")) {
      const result = await shell.exec([item.command, ...item.argv].join(" "), { stdin: item.stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: item.stdout, stderr: item.stderr, status: item.status
      }, item.argv.join(" "));
    }
  } finally { await shell.dispose(); }
});

const cases = [
  { name: "empty input preserves empty header", argv: "-a", stdin: "", stdout: "\n", stderr: "", status: 0 },
  { name: "header only has no empty-column report", argv: "-a", stdin: "a,b\n", stdout: "a,b\n", stderr: "", status: 0 },
  { name: "blank data row retains physical count", argv: "--length-mismatch", stdin: "a,b\n\nx,y\n", stdout: "a,b\n\nx,y\n", stderr: "line_number,msg,a,b\n1,\"Expected 2 columns, found 0 columns\"\n", status: 1 },
  { name: "multiline error uses final physical line", argv: "--length-mismatch", stdin: "a,b\n\"x\ny\"\nz,w,t\n", stdout: "a,b\n\"x\ny\"\nz,w,t\n", stderr: "line_number,msg,a,b\n2,\"Expected 2 columns, found 1 columns\",\"x\ny\"\n3,\"Expected 2 columns, found 3 columns\",z,w,t\n", status: 1 },
  { name: "omit is length-based even without mismatch check", argv: "--header-normalize-space --omit-error-rows", stdin: " a , b \nx\ny,z\n", stdout: "a,b\ny,z\n", stderr: "", status: 0 },
  { name: "file warning does not omit valid-length rows", argv: "--empty-columns --omit-error-rows", stdin: "a,b\nx,\ny,\n", stdout: "a,b\nx,\ny,\n", stderr: "line_number,msg,a,b\n1,Empty columns named 'b'! Try: csvcut -C 2,,\n", status: 1 },
  { name: "all checks retain ordered row and file errors", argv: "-a --omit-error-rows", stdin: "a,b\nx\ny,\n", stdout: "a,b\ny,\n", stderr: "line_number,msg,a,b\n1,\"Expected 2 columns, found 1 columns\",x\n1,Empty columns named 'b'! Try: csvcut -C 2,,\n", status: 1 },
  { name: "fill precedes empty counting and length checks", argv: "-a --fill-short-rows --fillvalue X", stdin: "a,b\nx\n\n", stdout: "a,b\nx,X\nX,X\n", stderr: "", status: 0 },
  { name: "joining does not retract earlier stdout rows", argv: "--join-short-rows --separator :", stdin: "a,b,c\nx,y\nz,w\n", stdout: "a,b,c\nx,y\nx,y:z,w\n", stderr: "", status: 0 },
  { name: "joining blank trailing row adds edge separator", argv: "--join-short-rows --separator :", stdin: "a,b,c\nx,y\n\nz,w\n", stdout: "a,b,c\nx,y\n\nx,y::z,w\n", stderr: "", status: 0 },
  { name: "no header flag does not invent a header for cleaner", argv: "--length-mismatch -H", stdin: "x,y\nz\n", stdout: "x,y\nz\n", stderr: "line_number,msg,x,y\n1,\"Expected 2 columns, found 1 columns\",z\n", status: 1 },
  { name: "null fill is not counted as an empty string", argv: "-a --fill-short-rows", stdin: "a,b\nx\ny\n", stdout: "a,b\nx,\ny,\n", stderr: "", status: 0 },
  { name: "empty-string fill retains empty-column warning", argv: "-a --fill-short-rows --fillvalue ''", stdin: "a,b\nx\ny\n", stdout: "a,b\nx,\ny,\n", stderr: "line_number,msg,a,b\n1,Empty columns named 'b'! Try: csvcut -C 2,,\n", status: 1 },
  { name: "empty separator joins adjacent edge cells literally", argv: "--join-short-rows --separator '' --omit-error-rows", stdin: "a,b,c\nx,y\nz,w\n", stdout: "a,b,c\nx,yz,w\n", stderr: "", status: 0 },
  { name: "full row resets short-row candidates", argv: "--join-short-rows --separator : --omit-error-rows", stdin: "a,b,c\nx,y\n1,2,3\nz,w\n", stdout: "a,b,c\n1,2,3\n", stderr: "", status: 0 },
  { name: "overflow join drops oldest candidate then joins suffix", argv: "--join-short-rows --separator :", stdin: "a,b,c,d\nx,y,z\np,q,r\nu,v\n", stdout: "a,b,c,d\nx,y,z\np,q,r\np,q,r:u,v\n", stderr: "", status: 0 },
  { name: "blank initial join preserves released index exception", argv: "--join-short-rows", stdin: "a,b\n\nx\n", stdout: "a,b\n\n", stderr: "IndexError: list index out of range\n", status: 1 },
  { name: "zero numbering changes only empty-column recommendation", argv: "--empty-columns --zero --label -", stdin: "a,b,c\n,,x\n,,y\n", stdout: "a,b,c\n,,x\n,,y\n", stderr: "label,line_number,msg,a,b,c\nstdin,1,\"Empty columns named 'a', 'b'! Try: csvcut -C 0,1\",,,\n", status: 1 },
  { name: "empty label does not add diagnostic column", argv: "--length-mismatch --label ''", stdin: "a,b\nx\n", stdout: "a,b\nx\n", stderr: "line_number,msg,a,b\n1,\"Expected 2 columns, found 1 columns\",x\n", status: 1 },
  { name: "space normalization follows Python whitespace including control separators", argv: "--header-normalize-space", stdin: "\" a\u001cb\u0085c\u00a0d \"\nx\n", stdout: "a b c d\nx\n", stderr: "", status: 0 }
];

for (const item of cases) test(`csvclean stress ${item.name}`, async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec(`csvclean ${item.argv}`, { stdin: item.stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: item.stdout, stderr: item.stderr, status: item.status
    });
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});

test("csvclean stress filename label and stderr redirection preserve source bytes", async () => {
  const fs = new MemoryFileSystem();
  const input = new TextEncoder().encode("a,b\nx\n");
  await fs.writeFile("/source.csv", input);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvclean --length-mismatch --label - source.csv 2> errors.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "a,b\nx\n", stderr: "", status: 1
    });
    assert.equal(new TextDecoder().decode(await fs.readFile("/errors.csv")), "label,line_number,msg,a,b\nsource.csv,1,\"Expected 2 columns, found 1 columns\",x\n");
    assert.deepEqual(await fs.readFile("/source.csv"), input);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["errors.csv", "source.csv"]);
  } finally { await shell.dispose(); }
});

test("csvclean stress cancellation drains cooperative pending stdin exactly once", async () => {
  const controller = new AbortController();
  let admitted!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => resolve({ done: true, value: undefined });
  });
  let returned = 0;
  const stdin = { [Symbol.asyncIterator]: () => ({
    next: () => { admitted(); return pending; },
    return: async () => { returned++; release(); return { done: true as const, value: undefined }; }
  }) };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const execution = shell.exec("csvclean --length-mismatch", { stdin, signal: controller.signal });
  const rejected = assert.rejects(execution, reason => reason === false);
  try {
    await started;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(returned, 1);
    await rejected;
  } finally { release(); await rejected; await shell.dispose(); }
  assert.equal(returned, 1);
});

test("csvclean stress awaits each delayed sink before admitting later row output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const seen: Uint8Array[] = [];
  let active = 0;
  let settled = false;
  const execution = shell.exec("csvclean --length-mismatch", {
    stdin: "a,b\nx\ny,z\n",
    stdout: { async write(bytes) {
      assert.equal(active, 0, "later row writes must await the preceding sink write");
      active++;
      try {
        seen.push(Uint8Array.from(bytes));
        if (seen.length === 1) { started(); await barrier; }
      } finally { active--; }
    } }
  });
  execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await admitted;
    await Promise.resolve();
    assert.equal(active, 1);
    assert.equal(seen.length, 1, "no later cleaned row is admitted while the header sink is pending");
    assert.equal(new TextDecoder().decode(seen[0]), "a,b\n");
    assert.equal(settled, false, "invocation settlement must await the sink");
    release();
    const result = await execution;
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "a,b\nx\ny,z\n", stderr: "line_number,msg,a,b\n1,\"Expected 2 columns, found 1 columns\",x\n", status: 1
    });
    assert.equal(seen.map(bytes => new TextDecoder().decode(bytes)).join(""), "a,b\nx\ny,z\n");
    assert.equal(seen.length, 3);
    assert.equal(active, 0);
  } finally { release(); await execution; await shell.dispose(); }
});
