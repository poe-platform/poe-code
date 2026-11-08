import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfDocument, cosNumber, dictSet } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftotextCommand, runPdftotextCli } from "./index.js";

for (const rotation of [0, 90, 180, 270]) {
  for (const flags of [[], ["-raw"], ["-layout"], ["-bbox"], ["-tsv"], ["-raw", "-bbox"]]) {
    test(`page boundary clips individual characters (${rotation}, ${flags.join(" ")})`, async () => {
      const doc = PdfDocument.create(), page = doc.addPage([200, 100]);
      dictSet(page.pageDict, "Rotate", cosNumber(rotation));
      page.drawText("CroppedWord", { x: 165, y: 50, size: 12 });
      page.drawText("A", { x: 2, y: 50, size: 12 });
      page.drawText("HiddenAbove", { x: 20, y: 101, size: 12 });
      page.drawText("HiddenBelow", { x: 20, y: -1, size: 12 });
      page.drawText("HiddenLeft", { x: -200, y: 50, size: 12 });
      const input = doc.save(), args = [...flags, "/edge.pdf", "-"];
      const fs = createMemoryFileSystem(); await fs.writeFile("/edge.pdf", input);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], argumentValues = createCommandArguments(args);
      const result = await createPdftotextCommand().execute({
        command: "pdftotext", args: argumentValues.args, argumentValues, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
      });
      assert.equal(result.exitCode, 0); assert.equal(Buffer.concat(stderr).toString(), "");
      const output = Buffer.concat(stdout).toString();
      assert.ok(output.includes("Croppe"), output); assert.ok(!output.includes("Cropped"), output);
      assert.ok(output.includes("A"), output);
      assert.ok(!output.includes("Hidden"), output);
      if (!rotation && !flags.length) assert.equal(output, "A\n\nCroppe\n\n\f");
      const legacy = await runPdftotextCli(args, new Map([["/edge.pdf", input]]));
      assert.ok(legacy.output.includes("Croppe"), legacy.output);
      assert.ok(!legacy.output.includes("Cropped"), legacy.output);
      assert.ok(!legacy.output.includes("Hidden"), legacy.output);
      assert.deepEqual(await fs.readdir("/scratch"), []);
    });
  }
}
