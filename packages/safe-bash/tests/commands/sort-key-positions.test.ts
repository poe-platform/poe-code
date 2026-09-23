import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { Shell } from "../../src/shell/shell.js";
import { chunks, fixture, run } from "./helpers.js";

for (const delimiter of ["\n", "\0"]) {
  for (const mode of ["-s", "-u", "-rs", "-ru"]) {
    test(`sort ${mode} preserves keys beyond field boundaries with ${delimiter === "\n" ? "LF" : "NUL"} records`, async context => {
      const input = ["w|Q9", "x|A9", "y|M9"].join(delimiter) + delimiter;
      const expected = (mode.includes("r") ? ["w|Q9", "y|M9", "x|A9"] : ["x|A9", "y|M9", "w|Q9"]).join(delimiter) + delimiter;
      const fs = await fixture({ records: input });
      const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(agentCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(`sort ${mode} ${delimiter === "\0" ? "-z" : ""} -t '|' -k 1.3,1.4 records > actual.bin; result=$?; cat actual.bin; exit "$result"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
      assert.deepEqual(await fs.readFile("/work/actual.bin"), new TextEncoder().encode(expected));
      assert.deepEqual(await fs.readFile("/work/records"), new TextEncoder().encode(input));
    });
  }
}

test("sort character offsets cross separators from the selected field start", async () => {
  for (const [args, stdin, expected] of [
    [["-t|", "-k1.1,1.4"], "x|Q9\nx|A9\nx|M9\n", "x|A9\nx|M9\nx|Q9\n"],
    [["-t|", "-k1.3,1.3"], "w|Q9\nx|A9\ny|M9\n", "x|A9\ny|M9\nw|Q9\n"],
    [["-t|", "-k2.3,2.4"], "p|w|Q9\np|x|A9\np|y|M9\n", "p|x|A9\np|y|M9\np|w|Q9\n"],
    [["-t|", "-k1.3,1.99"], "w|Q9\nx|A9\ny|M9\n", "x|A9\ny|M9\nw|Q9\n"],
    [["-k1.3,1.4"], "w Q9\nx A9\ny M9\n", "x A9\ny M9\nw Q9\n"],
    [["-k2.4,2.5"], "p w Q9\np x A9\np y M9\n", "p x A9\np y M9\np w Q9\n"],
    [["-b", "-k1.3,1.4"], "  w Q9\n x A9\n\ty M9\n", " x A9\n\ty M9\n  w Q9\n"],
  ] as const) {
    const result = await run("sort", ["-s", ...args], { stdin: chunks(stdin) });
    assert.equal(result.exitCode, 0, args.join(" "));
    assert.equal(result.stderr, "", args.join(" "));
    assert.equal(result.stdout, expected, args.join(" "));
  }
});

test("sort retains whole-field endpoints, in-field positions and empty keys", async () => {
  const stdin = "w|Q9\nx|A9\ny|M9\n";
  for (const [key, expected] of [
    ["1,1", stdin],
    ["2,2", "x|A9\ny|M9\nw|Q9\n"],
    ["2.1,2.2", "x|A9\ny|M9\nw|Q9\n"],
    ["1.3", "x|A9\ny|M9\nw|Q9\n"],
    ["1.3,1", stdin],
    ["1.4,1.3", stdin],
    ["1.99,1.100", stdin],
    ["3.1,3.2", stdin],
  ] as const) {
    const result = await run("sort", ["-s", "-t|", "-k", key], { stdin });
    assert.equal(result.exitCode, 0, key);
    assert.equal(result.stderr, "", key);
    assert.equal(result.stdout, expected, key);
  }
});

test("sort unique removes only equal spilled keys and retains the first matching row", async () => {
  for (const [key, stdin, expected] of [
    ["1.3,1.4", "w|Q9\nx|A9\ny|M9\nz|A9\n", "x|A9\ny|M9\nw|Q9\n"],
    ["1.3,1.4n", "w|20\nx|03\ny|11\nz|3\n", "x|03\ny|11\nw|20\n"],
  ] as const) {
    const result = await run("sort", ["-u", "-t|", "-k", key], { stdin: chunks(stdin) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  }
});

test("sort spilled keys preserve distinct raw bytes through unique sorting", async () => {
  const result = await run("sort", ["-u", "-t|", "-k1.3,1.4"], {
    stdin: chunks(Uint8Array.of(97, 124, 255, 49, 10, 98, 124, 254, 49, 10, 99, 124, 255, 50, 10)),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdoutBytes, Buffer.from([98, 124, 254, 49, 10, 97, 124, 255, 49, 10, 99, 124, 255, 50, 10]));
});

test("sort checks and merges using keys beyond field boundaries", async () => {
  const args = ["-t|", "-k1.3,1.4"];
  for (const [stdin, exitCode] of [["x|A9\ny|M9\nw|Q9\n", 0], ["w|Q9\nx|A9\ny|M9\n", 1], ["x|A9\nz|A9\n", 1]] as const) {
    const result = await run("sort", ["-cu", ...args], { stdin });
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, exitCode ? "sort: disorder at record 2\n" : "");
  }
  const fs = await fixture({ first: "x|A9\nw|Q9\n", second: "z|A9\ny|M9\n" });
  const result = await run("sort", ["-mu", ...args, "-o", "first", "first", "second"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/work/first"), new TextEncoder().encode("x|A9\ny|M9\nw|Q9\n"));
});
