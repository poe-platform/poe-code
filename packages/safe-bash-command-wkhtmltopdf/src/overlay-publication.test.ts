import assert from "node:assert/strict";
import {it} from "node:test";
import {createMemoryFileSystem, createOverlayFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments, type CommandContext} from "safe-bash-contracts/command";
import {toByteSource} from "safe-bash-contracts/io";
import {createWkhtmltopdfCommand} from "./command.js";

for (const existing of ["absent", "lower", "upper"] as const) {
  it(`publishes PDF to an overlay with ${existing} output`, async () => {
    const lower = createMemoryFileSystem(), upper = createMemoryFileSystem();
    const encode = (text: string) => new TextEncoder().encode(text);
    await lower.writeFile("/page.html", encode("<h1>Orchard</h1><p>A report</p>"));
    if (existing !== "absent") await (existing === "lower" ? lower : upper).writeFile("/page.pdf", encode("original"));
    const fs = createOverlayFileSystem({lower, upper});
    const args = createCommandArguments(["/page.html", "/page.pdf"]);
    const errors: string[] = [], cleanups: (() => void | Promise<void>)[] = [];
    const context: CommandContext = {command: "wkhtmltopdf", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: toByteSource(""), stdout: {async write() {}},
      stderr: {async write(bytes) {errors.push(new TextDecoder().decode(bytes));}}, registerCleanup(cleanup) {cleanups.push(cleanup);}};
    try {
      assert.equal((await createWkhtmltopdfCommand().execute(context)).exitCode, 0, errors.join(""));
      assert.ok(new TextDecoder().decode(await fs.readFile("/page.pdf")).startsWith("%PDF-"));
      assert.deepEqual(await upper.readFile("/page.pdf"), await fs.readFile("/page.pdf"));
      if (existing === "lower") assert.equal(new TextDecoder().decode(await lower.readFile("/page.pdf")), "original");
    } finally {for (const cleanup of cleanups.reverse()) await cleanup();}
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["page.html", "page.pdf"]);
  });
}
