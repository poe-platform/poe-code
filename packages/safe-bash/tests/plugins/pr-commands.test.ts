import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

for (const selection of ["--pages=1", "--pages 1", "+1", "+1:1"]) {
  test(`pr accepts GNU page selection ${selection}`, async () => {
    const fs = entry.createMemoryFileSystem();
    await fs.writeFile("/data", new TextEncoder().encode("alpha\nbeta\n"));
    await fs.utimes("/data", 1577934245000, 1577934245000);
    const shell = new entry.Shell({ fs, env: { LC_ALL: "C", TZ: "UTC" } }).use(entry.agentCommands());
    try {
      assert.deepEqual(await shell.exec(`pr ${selection} /data`), await shell.exec("pr /data"));
    } finally { await shell.dispose(); }
  });
}

for (const selection of ["--pages=2:2", "--pages 2:2", "+2:2"]) {
  test(`pr selects later pages with original line numbers using ${selection}`, async () => {
    const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands());
    try {
      const result = await shell.exec(`pr -t -l2 -n ${selection}`, { stdin: "a\nb\nc\nd\ne\nf\n" });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "    3\tc\n    4\td\n");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

for (const [args, input, expected] of [
  ["-t -l2 --pages=2", "a\nb\nc\nd\ne\n", "c\nd\ne\n"],
  ["-t -l2 +4", "a\nb\nc\n", ""],
  ["-t -l2 -2 -w9 +2:2", "1\n2\n3\n4\n5\n6\n7\n8\n9\n", "5    7\n6    8\n"],
  ["-t -l2 +2:2", "a\f\nb\f\nc\n", "b\n\f"],
] as const) {
  test(`pr page selection preserves pagination for ${args}`, async () => {
    const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands());
    try {
      const result = await shell.exec(`pr ${args}`, { stdin: input });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("pr page selection keeps header page numbers and honors the operand delimiter", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.writeFile("/+2", new TextEncoder().encode("literal\n"));
  const shell = new entry.Shell({ fs, env: { LC_ALL: "C", TZ: "UTC" } })
    .use(entry.agentCommands({ pr: { clock: () => 946684800000 } }));
  try {
    const result = await shell.exec("pr -l11 +2:2", { stdin: "a\nb\nc\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "\n\n2000-01-01 00:00                                                  Page 2\n\n\nb\n\n\n\n\n\n");
    assert.equal((await shell.exec("pr -t -- +2")).stdout, "literal\n");
  } finally { await shell.dispose(); }
});

for (const range of ["0", "2:1", "1:", "1:2:3", "no", "2147483648"]) {
  test(`pr refuses invalid page selection ${range}`, async () => {
    const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands());
    try {
      const result = await shell.exec(`pr --pages=${range}`, { stdin: "a\n" });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("invalid page range"));
    } finally { await shell.dispose(); }
  });
}

test("the default preset and public factories expose pr", () => {
  assert.equal(entry.createAgentCommands().filter(command => command.name === "pr").length, 1);
  for (const name of ["createPrCommand", "createPrCommands", "prCommands"]) {
    assert.ok(name in entry, `Missing public export: ${name}`);
  }
});

test("a saved script paginates a virtual file into balanced native columns", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  const input = new TextEncoder().encode("1\n2\n3\n4\n5\n6\n7\n");
  await fs.writeFile("/work/input", input);
  await fs.writeFile("/work/workflow.sh", new TextEncoder().encode("pr -3 -t -w20 input\n"));
  const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh workflow.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "1      4      6\n2      5      7\n3\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/work/input"), input);
    assert.deepEqual((await fs.readdir("/work")).map(item => item.name), ["input", "workflow.sh"]);
  } finally { await shell.dispose(); }
});

test("pr merges numbered virtual files without truncating separated fields", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/left", new TextEncoder().encode("1\n2\n3\n4\n"));
  await fs.writeFile("/work/right", new TextEncoder().encode("A\nB\nC\n"));
  const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands());
  try {
    const result = await shell.exec("pr -m -t -n -s: left right");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "    1\t1:A\n    2\t2:B\n    3\t3:C\n    4\t4:\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("the aggregate forwards the pr clock without reading nested replacement", async () => {
  let samples = 0;
  const options = { clock: () => { samples++; return 946684800000; } };
  Object.defineProperty(options, "replace", { enumerable: true, get() { throw new Error("Unexpected nested replace"); } });
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C", TZ: "UTC" } })
    .use(entry.agentCommands({ pr: options }));
  try {
    const result = await shell.exec("pr -h TITLE -l12", { stdin: "1\n2\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "\n\n2000-01-01 00:00                      TITLE                       Page 1\n\n\n1\n2\n\n\n\n\n\n");
    assert.equal(result.stderr, "");
    assert.equal(samples, 1);
  } finally { await shell.dispose(); }
});

test("the aggregate forwards pr input limits", async () => {
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() })
    .use(entry.agentCommands({ pr: { limits: { maxInputBytes: 2 } } }));
  try {
    const result = await shell.exec("pr -t", { stdin: "abc\n" });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.match(result.stderr, /limit/u);
  } finally { await shell.dispose(); }
});
