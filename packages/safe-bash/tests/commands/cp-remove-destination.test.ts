import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("remove-destination replaces an inode while preserving other hard links", async () => {
  const fs = await fixture({ input: "old\n", second: "new\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("ln input link; cp --remove-destination second input; cat link");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "old\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "new\n");
});

for (const dangling of [false, true]) {
  test(`remove-destination replaces a ${dangling ? "dangling" : "live"} destination symlink`, async () => {
    const fs = await fixture({ input: "new", ...(dangling ? {} : { referent: "old" }) });
    await fs.symlink("referent", "/work/output");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec("cp --remove-destination input output");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal((await fs.lstat("/work/output")).type, "file");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "new");
    if (dangling) await assert.rejects(fs.stat("/work/referent"), { code: "ENOENT" });
    else assert.equal(new TextDecoder().decode(await fs.readFile("/work/referent")), "old");
  });
}

test("remove-destination handles recursive leaves, backups, no-clobber and missing targets", async () => {
  const fs = await fixture({ "source/file": "new", "target/source/file": "old", input: "new", output: "old" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("ln target/source/file link; cp -R --remove-destination source target; cp -n --remove-destination input output; cat output; cp -b --remove-destination input output; cp --remove-destination input missing; cat link");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "oldold");
  for (const path of ["target/source/file", "output", "missing"]) {
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${path}`)), "new");
  }
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output~")), "old");
});

test("remove-destination rejects same-file and directory replacements without deleting data", async () => {
  const fs = await fixture({ input: "old", "directory/file": "retained" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  for (const command of ["cp --remove-destination input input", "cp -T --remove-destination input directory"]) {
    assert.equal((await shell.exec(command)).exitCode, 1, command);
  }
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "old");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/directory/file")), "retained");
});

for (const capability of ["remove", "exclusiveCopy"] as const) {
  test(`remove-destination admits ${capability} before changing any destination`, async () => {
    const fs = await fixture({ input: "new", output: "old" });
    const restricted = new Proxy(fs, {
      get(target, property) {
        if (property === "capabilities") return { ...target.capabilities, [capability]: false };
        if (property === "capabilitiesFor") return undefined;
        const member: unknown = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const shell = new Shell({ fs: restricted, cwd: "/work" }).use(agentCommands());
    assert.equal((await shell.exec("cp --remove-destination input output")).exitCode, 1);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "old");
  });
}
