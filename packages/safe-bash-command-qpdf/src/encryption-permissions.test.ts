import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/encryption-permissions.json", import.meta.url), "utf8")) as {
  cases: { flags: string[]; report: string }[];
};
for (const { flags, report } of fixtures.cases) {
  for (const path of ["buffered", "sync", "retained"]) it(`encrypts with native qpdf permissions: ${flags.join(" ") || "default"} (${path})`, async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const input = doc.save();
    const args = ["--encrypt", "reader", "owner", "256", ...flags, "--", "/in.pdf", "/out.pdf"];
    let encrypted: Uint8Array;
    if (path === "retained") {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      encrypted = await fs.readFile("/out.pdf");
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else {
      const files = new Map([["/in.pdf", input]]);
      const result = await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files);
      assert.equal(result.exitCode, 0, result.stderr);
      encrypted = files.get("/out.pdf")!;
    }
    const result = await runQpdfCli(["--password=owner", "--show-encryption", "/out.pdf"], new Map([["/out.pdf", encrypted]]));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, report);
  });
}
