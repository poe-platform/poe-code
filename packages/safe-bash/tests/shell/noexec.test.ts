import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const source of [
  "set -n; printf unreachable",
  "set -o noexec; printf unreachable",
  "set -en; printf unreachable\nprintf later",
  "set +n; set +o noexec; printf reachable",
  "set -n +n; printf reachable",
  "if true; then set -n; printf unreachable; fi; printf later",
  "stop() { set -n; }; stop; printf unreachable",
  "(set -n; printf unreachable); printf parent",
  "printf '%s' \"$(set -n; printf unreachable)\"; printf parent",
  "eval 'set -n; printf unreachable'; printf later",
  "set -n; set +n; printf unreachable",
  "set -n\nprintf unreachable\nif true; then",
] as const) {
  test(`noexec matches Bash: ${source}`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    const reference = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", timeout: 1000, env: { PATH: process.env.PATH, LC_ALL: "C", TZ: "UTC" } });
    assert.ifError(reference.error);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, reference.status, result.stderr);
    assert.equal(result.stdout, reference.stdout);
    assert.equal(Boolean(result.stderr), Boolean(reference.stderr));
  });
}

for (const interpreter of ["bash", "sh"]) {
  for (const option of ["-n", "-en", "-o noexec"]) {
    for (const mode of ["file", "command", "stdin"] as const) {
      test(`${interpreter} ${option} parses ${mode} without effects`, async () => {
        const { shell, fs } = setup();
        const source = 'value=$(say substituted > substitution); say unreachable > output; exit 17';
        await fs.writeFile("/script.sh", new TextEncoder().encode(source));
        await fs.writeFile("/output", new TextEncoder().encode("old"));
        const invocation = `${interpreter} ${option} ${mode === "file" ? "script.sh" : mode === "command" ? `-c '${source}'` : "-s"}`;
        const result = await shell.exec(invocation, { stdin: source });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "old");
        await assert.rejects(fs.stat("/substitution"), { code: "ENOENT" });
      });
    }
  }
  test(`${interpreter} -n still rejects malformed source`, async () => {
    const { shell, fs } = setup();
    const source = "say unreachable\nif true; then";
    await fs.writeFile("/broken.sh", new TextEncoder().encode(source));
    for (const invocation of [`${interpreter} -n broken.sh`, `${interpreter} -nc '${source}'`, `${interpreter} -ns`]) {
      const result = await shell.exec(invocation, { stdin: source });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /syntax error/u);
    }
  });
}

test("noexec option listing and child toggles", async () => {
  const { shell } = setup();
  const listing = await shell.exec("set -o; set +o");
  assert.equal(listing.stderr, "");
  assert.ok(listing.stdout.includes("noexec\toff\n"));
  assert.ok(listing.stdout.includes("set +o noexec\n"));
  const result = await shell.exec("bash -n +n -c 'say enabled'; say parent");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "enabled\nparent\n");
});

for (const option of ["-n", "-o noexec"]) {
  test(`set ${option} suppresses expansions and file effects`, async () => {
    const { shell, fs } = setup();
    await fs.writeFile("/output", new TextEncoder().encode("old"));
    const result = await shell.exec(`set ${option}; value=$(say substituted > substitution); say unreachable > output`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "old");
    await assert.rejects(fs.stat("/substitution"), { code: "ENOENT" });
    assert.equal((await shell.exec("say next")).stdout, "next\n");
  });
}
