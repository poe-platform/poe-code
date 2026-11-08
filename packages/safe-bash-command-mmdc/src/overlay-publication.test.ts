import assert from "node:assert/strict";
import {it} from "node:test";
import {createMemoryFileSystem, createOverlayFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments, type CommandContext} from "safe-bash-contracts/command";
import {toByteSource} from "safe-bash-contracts/io";
import {createMmdcCommand} from "./index.js";

for (const existing of ["absent", "lower", "upper"] as const) {
  it(`publishes SVG to an overlay with ${existing} output`, async () => {
    const lower = createMemoryFileSystem(), upper = createMemoryFileSystem();
    const encode = (text: string) => new TextEncoder().encode(text);
    await lower.writeFile("/diagram.mmd", encode("flowchart TD; A --> B"));
    if (existing !== "absent") await (existing === "lower" ? lower : upper).writeFile("/diagram.svg", encode("original"));
    const fs = createOverlayFileSystem({lower, upper});
    const args = createCommandArguments(["-i", "/diagram.mmd", "-o", "/diagram.svg"]);
    const errors: string[] = [], cleanups: (() => void | Promise<void>)[] = [];
    const context: CommandContext = {command: "mmdc", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: toByteSource(""), stdout: {async write() {}},
      stderr: {async write(bytes) {errors.push(new TextDecoder().decode(bytes));}}, registerCleanup(cleanup) {cleanups.push(cleanup);}};
    try {
      assert.equal((await createMmdcCommand().execute(context)).exitCode, 0, errors.join(""));
      assert.ok(new TextDecoder().decode(await fs.readFile("/diagram.svg")).includes("<svg"));
      assert.deepEqual(await upper.readFile("/diagram.svg"), await fs.readFile("/diagram.svg"));
      if (existing === "lower") assert.equal(new TextDecoder().decode(await lower.readFile("/diagram.svg")), "original");
    } finally {for (const cleanup of cleanups.reverse()) await cleanup();}
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["diagram.mmd", "diagram.svg"]);
  });
}
