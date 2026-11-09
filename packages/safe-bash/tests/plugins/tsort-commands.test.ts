import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

for (const [operand, error] of [
  ["missing/../f", "No such file or directory"],
  ["f/", "Not a directory"],
  ["f/.", "Not a directory"],
  ["f/../f", "Not a directory"],
  ["f", ""],
  ["./f", ""],
  ["dir/../f", ""],
] as const) {
  for (const absolute of [false, true]) {
    for (const mode of ["direct", "substitution", "loop"] as const) {
      test(`tsort validates input components: ${absolute ? "/work/" : ""}${operand} (${mode})`, async () => {
        const fs = entry.createMemoryFileSystem();
        await fs.mkdir("/work/dir", { recursive: true });
        await fs.writeFile("/work/f", new TextEncoder().encode("a b\n"));
        const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands());
        const path = absolute ? `/work/${operand}` : operand;
        const command = `tsort ${path}`;
        const capture = `value=$(${command}); status=$?; printf '%s' "$value"; exit "$status"`;
        try {
          const result = await shell.exec(mode === "direct" ? command : mode === "substitution" ? capture : `for i in 1; do ${capture}; done`);
          assert.equal(result.exitCode, error ? 1 : 0);
          assert.equal(result.stdout, error ? "" : mode === "direct" ? "a\nb\n" : "a\nb");
          assert.equal(result.stderr, error ? `tsort: ${path}: ${error}\n` : "");
        } finally { await shell.dispose(); }
      });
    }
  }
}

test("the default preset and public factories expose tsort", () => {
  assert.equal(entry.createAgentCommands().filter(command => command.name === "tsort").length, 1);
  for (const name of ["createTsortCommand", "createTsortCommands", "tsortCommands"]) {
    assert.ok(name in entry, `Missing public export: ${name}`);
  }
});

test("a saved tsort script preserves native initial ordering and FIFO successors", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  const graph = new TextEncoder().encode("a b z z\n");
  await fs.writeFile("/work/graph", graph);
  await fs.writeFile("/work/workflow.sh", new TextEncoder().encode("tsort graph > ordered && cat ordered\n"));
  const shell = new entry.Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh workflow.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "a\nz\nb\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/work/graph"), graph);
    assert.deepEqual(await fs.readFile("/work/ordered"), new TextEncoder().encode(result.stdout));
  } finally { await shell.dispose(); }
});

test("tsort reports a cycle and retains native output and nonzero status", async () => {
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("tsort", { stdin: "a b b a\n" });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, "a\nb\n");
    assert.equal(result.stderr, "tsort: -: input contains a loop:\ntsort: a\ntsort: b\n");
  } finally { await shell.dispose(); }
});

test("tsort rejects an odd token count before emitting an ordering", async () => {
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("tsort", { stdin: "a b c\n" });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "tsort: -: input contains an odd number of tokens\n");
  } finally { await shell.dispose(); }
});

test("the aggregate forwards tsort limits without reading nested replacement", async () => {
  const options = { limits: { maxNodes: 2 } };
  Object.defineProperty(options, "replace", { enumerable: true, get() { throw new Error("Unexpected nested replace"); } });
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } })
    .use(entry.agentCommands({ tsort: options }));
  try {
    const result = await shell.exec("tsort", { stdin: "a b c c\n" });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /limit/u);
  } finally { await shell.dispose(); }
});
