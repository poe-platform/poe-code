import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "../../safe-bash-command-qpdf/src/index.js";

it("native qpdf confirms attachment MIME type and explicit creation and modification dates through both paths", async () => {
  const out = join(process.cwd(), "out");
  await mkdir(out, { recursive: true });
  const directory = await mkdtemp(join(out, "qpdf-attachment-"));
  try {
    const input = join(directory, "in.pdf"), payload = join(directory, "notes.txt");
    const native = join(directory, "native.pdf"), actual = join(directory, "actual.pdf");
    execFileSync("qpdf", ["--empty", input]);
    await writeFile(payload, "attachment bytes\n");
    const options = ["--add-attachment", payload, "--key=notes", "--filename=display.txt", "--mimetype=text/plain", "--creationdate=D:20200101000000Z", "--moddate=D:20210203040506Z", "--"];
    execFileSync("qpdf", [input, native, ...options]);
    const inspect = (path: string) => JSON.parse(execFileSync("qpdf", ["--json", "--json-key=attachments", path], { encoding: "utf8" })).attachments.notes;
    const expected = inspect(native);
    assert.equal(expected.streams["/F"].mimetype, "text/plain");
    assert.equal(expected.streams["/F"].creationdate, "2020-01-01T00:00:00Z");
    // qpdf 12.4.2 reports CreationDate for both JSON date fields; check raw ModDate too.
    const modificationDates = (path: string) => {
      const objects = JSON.parse(execFileSync("qpdf", ["--json", "--json-key=qpdf", path], { encoding: "utf8" })).qpdf[1];
      return Object.values(objects).flatMap((object: any) => object.stream?.dict?.["/Params"]?.["/ModDate"] ?? []);
    };
    assert.deepEqual(modificationDates(native), ["u:D:20210203040506Z"]);
    const files = new Map([[input, new Uint8Array(await readFile(input))], [payload, new Uint8Array(await readFile(payload))]]);
    const args = [input, actual, ...options];
    for (const retained of [false, true]) {
      let bytes: Uint8Array;
      if (retained) {
        const fs = createMemoryFileSystem();
        await fs.mkdir(directory, { recursive: true });
        for (const [path, content] of files) await fs.writeFile(path, content);
        const carrier = createCommandArguments(args);
        const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: directory, env: { TMPDIR: directory }, fs, signal: new AbortController().signal,
          stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { assert.fail(Buffer.from(bytes).toString()); } } });
        assert.equal(result.exitCode, 0);
        bytes = await fs.readFile(actual);
      } else {
        assert.equal((await runQpdfCli(args, files)).exitCode, 0);
        bytes = files.get(actual)!;
      }
      await writeFile(actual, bytes);
      assert.deepEqual(modificationDates(actual), modificationDates(native));
      const attachment = inspect(actual);
      assert.equal(attachment.preferredname, expected.preferredname);
      for (const key of ["/F", "/UF"]) {
        for (const field of ["mimetype", "creationdate", "modificationdate"]) assert.equal(attachment.streams[key][field], expected.streams[key][field], `${retained ? "retained" : "in-memory"} ${key} ${field}`);
      }
      assert.equal(execFileSync("qpdf", ["--show-attachment=notes", actual], { encoding: "utf8" }), "attachment bytes\n");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
