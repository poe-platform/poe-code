// Explicit source-only suite: XAN remains outside the public/default build.
import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.ts";
import { createMemoryFileSystem } from "../../src/fs/memory/index.ts";
import { xanCommands } from "../../src/commands/xan/index.ts";

async function run(options, data = "name,n\nAda,1\nGrace,2\n") {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data", new TextEncoder().encode(data));
  const shell = new Shell({ fs, cwd: "/" }).use(xanCommands());
  try { return await shell.exec(`xan count ${options} data`); }
  finally { await shell.dispose(); }
}

for (const options of ["--human-readable", "-H", "--check-alignment", "-c", "--approx", "-a", "--parallel", "-p", "--threads 2", "-t2", "--threads=2"]) {
  test(`count accepts ${options}`, async () => {
    const result = await run(options);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "2\n");
    assert.equal(result.stderr, options.includes("parallel") || options === "-p" || options.includes("threads") || options === "-t2" ? "nothing is actually parallelized!\n" : "");
  });
}
test("human count groups thousands and abbreviates large counts", async () => {
  assert.equal((await run("-H", "n\n" + "1\n".repeat(1234))).stdout, "1,234\n");
  assert.equal((await run("-H", "n\n" + "1\n".repeat(12345))).stdout, "12,345 (12.3k)\n");
});
test("alignment checks reject ragged rows while ordinary count permits them", async () => {
  const data = "a,b\n1\n";
  assert.equal((await run("", data)).stdout, "1\n");
  const result = await run("-c", data);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /found record with 1 fields/);
});
for (const options of ["-ac", "-pc", "-pa", "-t0", "-tno", "--threads"]) {
  test(`count rejects invalid options ${options}`, async () => {
    assert.equal((await run(options)).exitCode, 1);
  });
}

test("count modes preserve empty files, headers and quoted newlines", async () => {
  for (const option of ["-H", "-c", "-a", "-p", "-t2"]) {
    assert.equal((await run(option, "")).stdout, "0\n");
    assert.equal((await run(option + " -n", 'a,b\n"one\ntwo",3\n')).stdout, "2\n");
  }
});
test("execution options reject stdin and count flags stay count-specific", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(xanCommands());
  try {
    for (const option of ["-a", "-p", "-t2"]) assert.equal((await shell.exec(`xan count ${option}`)).exitCode, 1);
    assert.equal((await shell.exec("xan select -H 1")).exitCode, 1);
  } finally { await shell.dispose(); }
});
