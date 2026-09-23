import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

for (const canonical of [true, false]) for (const option of ["-C", "-o noclobber", "-uC"]) {
  test(`noclobber ${option} preserves existing output with descriptor API ${canonical}`, async () => {
    const fs = createMemoryFileSystem();
    if (!canonical) Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false } });
    await fs.writeFile("/output", new TextEncoder().encode("old"));
    const shell = new Shell({ fs }).use(agentCommands());
    const result = await shell.exec(`set ${option}; printf new > output; printf 'status=%s' "$?"; cat output`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "status=1old");
    assert.ok(result.stderr.includes("output: cannot overwrite existing file"));
    assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "old");
  });
}

for (const canonical of [true, false]) test(`noclobber permits creation, append, override and disabling with descriptor API ${canonical}`, async () => {
  const fs = createMemoryFileSystem();
  if (!canonical) Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false } });
  const shell = new Shell({ fs }).use(agentCommands());
  const result = await shell.exec("set -C; printf old > output; printf more >> output; cat output; printf forced >| output; cat output; set +C; printf short > output; cat output; set -o noclobber; set +o noclobber; printf final > output; cat output");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "oldmoreforcedshortfinal");
});

test("noclobber covers stderr and combined redirects and is inherited only by shell scopes", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/output", new TextEncoder().encode("old"));
  const shell = new Shell({ fs }).use(agentCommands());
  const result = await shell.exec('set -C; (printf new > output); printf "%s" "$?"; printf new 2> output; printf "%s" "$?"; printf new &> output; printf "%s" "$?"; f() { printf new > output; }; f; printf "%s" "$?"; bash -c \'printf child > output\'; cat output');
  assert.equal(result.stdout, "1111child");
  assert.equal(result.exitCode, 0);
});

test("noclobber is visible in option queries and does not persist across exec", async () => {
  const { shell } = setup();
  const queried = await shell.exec('set -C; args "$-"; [[ -o noclobber ]]');
  assert.equal(queried.exitCode, 0);
  assert.equal(queried.stdout, '["BC"]');
  const listed = await shell.exec("set -C; set +o");
  assert.ok(listed.stdout.includes("set -o noclobber\n"));
  assert.equal((await shell.exec("[[ -o noclobber ]]")).exitCode, 1);
});

test("native-backed errexit forms stop before subsequent commands and file effects", async () => {
  for (const source of [
    "set -e; false; say bad >after",
    "set -o errexit; false; say bad >after",
  ]) {
    const { shell, fs } = setup();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stdoutBytes.length, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stderrBytes.length, 0);
    assert.deepEqual(await fs.readdir("/"), []);
  }
});

test("combined errexit and nounset options succeed without taking the failure branch", async () => {
  const { shell, fs } = setup();
  const result = await shell.exec("set -eu || say unsafe >after");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readdir("/"), []);
  for (const source of ["set -eu; false; say unsafe >after", "set -eu; say \"$missing\"; say unsafe >after"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    if (source.includes("$missing")) assert.match(result.stderr, /missing: unbound variable/u);
    else assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readdir("/"), []);
  }
});

test("supported set forms still execute normally", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('set -- a b; args "$@"')).stdout, '["a","b"]');
  assert.equal((await shell.exec("set -o pipefail; false | true")).exitCode, 1);
  assert.equal((await shell.exec("set +o pipefail; false | true")).exitCode, 0);
});
