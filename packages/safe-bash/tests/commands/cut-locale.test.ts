import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { Shell } from "../../src/shell/index.js";
import { chunks, fixture, run } from "./helpers.js";

const cases = [
  { name: "invalid UTF-8", args: ["-c", "1"], input: "ff0a", output: "ff0a" },
  { name: "first UTF-8 byte", args: ["--characters=1"], input: "c3a90a", output: "c30a" },
  { name: "continuation byte", args: ["-c", "2"], input: "c3a90a", output: "a90a" },
  { name: "partial BOM", args: ["-c", "1-2"], input: "efbbbf410a", output: "efbb0a" },
  { name: "ranges and output delimiter", args: ["-c", "1,3-4", "--output-delimiter=|"], input: "ffc3a9805a0a", output: "ff7ca9800a" },
  { name: "complement", args: ["--characters=2-3", "--complement"], input: "ffc3a9800a", output: "ff800a" },
  { name: "NUL records", args: ["-z", "-c", "1"], input: "ff00c3a9", output: "ff00c300" },
  { name: "unterminated record", args: ["-c", "1-"], input: "ffc3", output: "ffc30a" },
];

for (const specimen of cases) for (const source of ["stdin", "single-byte chunks", "file"] as const) {
  test(`cut C locale preserves ${specimen.name} from ${source}`, async () => {
    const input = Buffer.from(specimen.input, "hex");
    const fs = await fixture(source === "file" ? { input } : {});
    const result = await run("cut", [...specimen.args, ...(source === "file" ? ["input"] : [])], {
      fs, env: { LC_ALL: "C" },
      ...(source === "file" ? {} : { stdin: source === "single-byte chunks" ? chunks(input, 1) : input }),
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdoutBytes.toString("hex"), specimen.output);
  });
}

test("cut character selection honors locale precedence and the default Unicode mode", async () => {
  const profiles: { env: Record<string, string>; output: string }[] = [
    { env: { LC_ALL: "C", LC_CTYPE: "C.UTF-8", LANG: "C.UTF-8" }, output: "c30a" },
    { env: { LC_ALL: "POSIX" }, output: "c30a" },
    { env: { LC_CTYPE: "C", LANG: "C.UTF-8" }, output: "c30a" },
    { env: { LC_ALL: "", LC_CTYPE: "POSIX", LANG: "C.UTF-8" }, output: "c30a" },
    { env: { LANG: "C" }, output: "c30a" },
    { env: { LC_ALL: "", LC_CTYPE: "", LANG: "POSIX" }, output: "c30a" },
    { env: { LC_ALL: "C.UTF-8", LC_CTYPE: "C", LANG: "C" }, output: "c3a90a" },
    { env: { LC_CTYPE: "C.utf8", LANG: "C" }, output: "c3a90a" },
    { env: {}, output: "c3a90a" },
  ];
  for (const { env, output } of profiles) {
    const result = await run("cut", ["-c", "1"], { env, stdin: "é\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdoutBytes.toString("hex"), output, JSON.stringify(env));
  }
});

test("cut C locale preserves bytes through shell pipelines and file redirection", async () => {
  const fs = await fixture({ input: Buffer.from("ff0ac3a90a", "hex") });
  const shell = new Shell({ fs, cwd: "/work", env: { LANG: "C.UTF-8" } }).use(standardCommands());
  try {
    const result = await shell.exec("cat input | LC_ALL=C cut -c 1 > selected; cat selected");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 10, 195, 10));
    assert.deepEqual(await fs.readFile("/work/selected"), Uint8Array.of(255, 10, 195, 10));
  } finally { await shell.dispose(); }
});
