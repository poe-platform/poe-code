import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const [command, backup] of [
  ["cp --backup=numbered input output", "output.~1~"],
  ["cp -b --suffix=.saved input output", "output.saved"],
  ["cp -b -S .audit input output", "output.audit"],
  ["cp -bS.audit input output", "output.audit"],
  ["cp --backup=simple input output", "output~"],
  ["cp --backup input output", "output~"],
] as const) {
  test(command, async () => {
    const fs = await fixture({ input: "new\n", output: "old\n" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${backup}`)), "old\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "new\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "new\n");
  });
}

test("numbered and existing backups advance beyond the highest existing number", async () => {
  const fs = await fixture({ input: "new", output: "old", "output.~2~": "previous" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  assert.equal((await shell.exec("cp --backup=existing input output")).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output.~3~")), "old");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output.~2~")), "previous");
  assert.equal((await shell.exec("cp --backup=numbered input output")).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output.~4~")), "new");
});

test("recursive copies back up replaced leaves and preserve destination symlinks", async () => {
  const fs = await fixture({ "source/file": "new", "target/source/file": "old", referent: "linked" });
  await fs.symlink("referent", "/work/link");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  assert.equal((await shell.exec("cp -Rb source target")).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/source/file~")), "old");
  assert.equal((await shell.exec("cp -b source/file link")).exitCode, 0);
  assert.equal(await fs.readlink("/work/link~"), "referent");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/referent")), "linked");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/link")), "new");
});

test("backup validation and same-file errors leave files unchanged", async () => {
  const fs = await fixture({ input: "new", output: "old" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  for (const command of ["cp --backup=invalid input output", "cp -bn input output", "cp -b input input", "cp -b -S input output"]) {
    assert.notEqual((await shell.exec(command)).exitCode, 0, command);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "new");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "old");
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["input", "output"]);
  }
});

test("disabled backups and missing destinations do not create backup files", async () => {
  const fs = await fixture({ input: "new", output: "old" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  assert.equal((await shell.exec("cp --backup=none input output; cp -b input missing")).exitCode, 0);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["input", "missing", "output"]);
});

test("backup defaults use exported shell settings and simple backups replace previous backups", async () => {
  const fs = await fixture({ input: "new", output: "old", "output.saved": "previous" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  assert.equal((await shell.exec("VERSION_CONTROL=simple SIMPLE_BACKUP_SUFFIX=.saved cp -b input output")).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output.saved")), "old");
  assert.equal((await shell.exec("VERSION_CONTROL=numbered cp --backup input output")).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output.~1~")), "new");
});

test("backup suffix cannot overwrite the source", async () => {
  const fs = await fixture({ output: "old", "output.saved": "new" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("cp -b -S .saved output.saved output");
  assert.equal(result.exitCode, 1);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output.saved")), "new");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "old");
});

test("backup rename refusal is admitted before modifying any destination", async () => {
  const fs = await fixture({ input: "new", output: "old" });
  const restricted = new Proxy(fs, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, rename: false };
      if (property === "capabilitiesFor") return undefined;
      const member: unknown = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const shell = new Shell({ fs: restricted, cwd: "/work" }).use(agentCommands());
  assert.equal((await shell.exec("cp -b input output")).exitCode, 1);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "old");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["input", "output"]);
});
