import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { getCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createExiftoolCommand } from "./command.js";
import { createExiftoolArguments } from "./sdk.js";
import { fixture } from "./fixtures.js";

const signal = new AbortController().signal;

test("typed SDK options create canonical argv and preserve literal operand authority", async () => {
  const carrier = createExiftoolArguments({ files: ["-Title=hostile", "-@"], tags: ["Title"], format: "json", quoteScalars: true, groupFamily: 4 }, { signal });
  assert.deepEqual(carrier.args, ["-j", "-api", "StructFormat=JSONQ", "-G4", "-Title", "--", "-Title=hostile", "-@"]);
  assert.equal(getCommandArguments({ args: carrier.args, argumentValues: carrier }), carrier);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/-Title=hostile", fixture("1e999"));
  await fs.writeFile("/-@", fixture("FALSE"));
  let stdout = "", stderr = "";
  const context: CommandContext = { command: "exiftool", args: carrier.args, argumentValues: carrier, signal, fs, cwd: "/", env: {},
    stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } };
  assert.equal((await createExiftoolCommand().execute(context)).exitCode, 0, stderr);
  assert.equal(stdout, '[{\n  "SourceFile": "-Title=hostile",\n  ":Title": "1e999"\n},\n{\n  "SourceFile": "-@",\n  ":Title": "FALSE"\n}]\n');
  assert.equal(stderr, "");
});

test("typed SDK assignments keep source order, deletions, and destination option values", () => {
  const carrier = createExiftoolArguments({ files: ["image.png"], assignments: [
    { name: "Title", operation: "set", value: "first" },
    { name: "Title", operation: "remove", value: "first" },
    { name: "Title", operation: "set", value: "" },
  ], overwrite: "in-place", destination: "-@" }, { signal });
  assert.deepEqual(carrier.args, ["-overwrite_original_in_place", "-o", "-@", "-Title=first", "-Title-=first", "-Title=", "--", "image.png"]);
});

test("typed SDK refuses option injection, unsupported combinations, cancellation and preallocation exhaustion", () => {
  for (const tag of ["config", "Title=x", "Title\u0000", "-Title", "Title#=x"]) {
    assert.throws(() => createExiftoolArguments({ files: ["image.png"], tags: [tag] }, { signal }));
    assert.throws(() => createExiftoolArguments({ files: ["image.png"], assignments: [{ name: tag, operation: "set", value: "x" }] }, { signal }));
  }
  assert.throws(() => createExiftoolArguments({ files: ["image.png"], format: "csv", tags: ["Title#"] }, { signal }), /ValueConv/);
  assert.throws(() => createExiftoolArguments({ files: ["image.png"], stay_open: true } as Parameters<typeof createExiftoolArguments>[0], { signal }), /Unsupported ExifTool SDK option/);
  assert.throws(() => createExiftoolArguments({ files: ["-"] , assignments: [{ name: "Title", operation: "set", value: "x" }] }, { signal }), /stdin/);
  assert.throws(() => createExiftoolArguments({ files: ["image.png"], assignments: [{ name: "Title", operation: "set", value: "x".repeat(1000) }] }, { signal, maxRetainedBytes: 4000 }), /retained budget/);
  assert.throws(() => createExiftoolArguments({ files: Array(4097).fill("image.png") }, { signal }), /argument count/);
  const controller = new AbortController(); const reason = new Error("cancel SDK"); controller.abort(reason);
  assert.throws(() => createExiftoolArguments({ files: ["image.png"] }, { signal: controller.signal }), error => error === reason);
});
