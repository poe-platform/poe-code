import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../../src/contracts/command.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";

for (const flag of ["-opretty.out", "--pretty-print=pretty.out"]) {
  test(`awk ${flag} formats a parsed program without execution`, async context => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    const result = await shell.exec(`awk ${flag} '{print $2}' /missing`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(Buffer.from(await fs.readFile("/pretty.out")).toString(), "{\n\tprint $2\n}\n\n");
  });
}

for (const flag of ["-Ddebug.commands", "--debug=debug.commands"]) {
  test(`awk ${flag} runs the owned batch run/quit workflow`, async context => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/owned.awk", Buffer.from('BEGIN { print "ActualDebug:53" }'));
    await fs.writeFile("/debug.commands", Buffer.from("run\nquit\n"));
    const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    const result = await shell.exec(`awk ${flag} -f owned.awk`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "ActualDebug:53\n");
  });
}

for (const flag of ["-ddump.out", "--dump-variables=dump.out"]) {
  test(`awk ${flag} publishes final actual variables`, async context => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    const result = await shell.exec(`awk ${flag} 'BEGIN { a["key"]=1; x=7; print x } END { x=9 }'`, { stdin: "" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "7\n");
    const dump = Buffer.from(await fs.readFile("/dump.out")).toString();
    assert.ok(dump.includes("x: 9\n"), dump);
    assert.ok(dump.includes("a: array, 1 elements\n"), dump);
    assert.ok(!dump.includes("FUNCTAB"), dump);
  });
}

for (const flag of ["-pprofile.out", "--profile=profile.out"]) {
  test(`awk ${flag} counts actual interpreter statements`, async context => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    const result = await shell.exec(`awk ${flag} '{ print $2 }'`, { stdin: "Independent 31\nChanged 47\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "31\n47\n");
    const profile = Buffer.from(await fs.readFile("/profile.out")).toString();
    assert.ok(profile.includes("safe-bash awk statement profile"), profile);
    assert.ok(profile.includes("2\tprint\n"), profile);
    assert.ok(!profile.includes("gawk profile"), profile);
  });
}

for (const flag of ["-I", "--trace"]) {
  test(`awk ${flag} traces actual interpreter statements`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    const result = await shell.exec(`awk ${flag} 'BEGIN { print "observed" }'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "observed\n");
    assert.equal(result.stderr, "+ safe-bash awk BEGIN block\n+ safe-bash awk BEGIN print\n");
  });
}

for (const flag of ["-o/out", "-d/out", "-p/out"]) {
  test(`awk ${flag} refuses excess file publication before changing the destination`, async context => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("seed"));
    const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()), limits: { maxOutputBytes: 4 } });
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec(`awk ${flag} 'BEGIN { x=1 }'`), { limit: "maxOutputBytes" });
    assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "seed");
  });
}

test("awk pretty printing preserves supported program semantics on reparse", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
  context.after(() => shell.dispose());
  const source = 'function transform(s) { return "Actual:" s } BEGIN { for(i=0;i<2;i++) { a[i]=i; if(i) print transform("\\001") } } /Changed/ { print $2 } END { for(k in a) print a[k]; delete a[0] }';
  const original = await shell.exec(`awk '${source}'`, { stdin: "Changed 47\n" });
  const pretty = await shell.exec(`awk -o/out '${source}'`);
  assert.equal(pretty.exitCode, 0, pretty.stderr);
  const reparsed = await shell.exec("awk -f /out", { stdin: "Changed 47\n" });
  assert.equal(reparsed.exitCode, 0, reparsed.stderr);
  assert.equal(reparsed.stdout, original.stdout);
});
