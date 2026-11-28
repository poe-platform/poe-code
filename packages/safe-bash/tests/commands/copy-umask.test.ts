import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { fixture } from "./helpers.js";

test("cp applies the shell umask to new files, directories and device copies", async () => {
  const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("umask 027; echo x > a; chmod 666 a; cp a b; stat -c %a b; mkdir s; chmod 777 s; cp -r s t; stat -c %a t; cp /dev/null c; stat -c %a c");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "640\n750\n640\n");
});

test("cp masks recursive children, restored directory modes and attributes-only creation", async () => {
  const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("umask 077; mkdir s; echo x > s/a; chmod 666 s/a; chmod 555 s; cp -r s t; stat -c %a t t/a; cp --attributes-only s/a b; stat -c %a b");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "500\n600\n600\n");
});

for (const option of ["-p", "--preserve=mode", "-a"]) {
  test(`cp ${option} preserves source modes despite the umask`, async () => {
    const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`umask 077; mkdir s; echo x > s/a; chmod 666 s/a; chmod 777 s; cp -r ${option} s t; stat -c %a t t/a`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "777\n666\n");
  });
}

test("cp keeps existing destination modes under a restrictive umask", async () => {
  const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("mkdir s t; echo x > s/a; echo old > t/a; chmod 777 t; chmod 664 t/a; umask 077; cp -r s/. t; stat -c %a t t/a");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "777\n664\n");
});
