import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const plain = readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-shared-images.pdf", import.meta.url));
const encrypted = PdfDocument.load(plain).save({ encrypt: { userPassword: "user", ownerPassword: "owner", revision: 6, permissions: { copy: true, modify: true, assemble: true } } });

for (const path of ["sync", "buffered", "retained"]) {
  for (const password of [undefined, "user", "owner"]) {
    it(`reports version 2 encryption fields (${path}, ${password ?? "plain"})`, async () => {
      const input = password ? encrypted : plain;
      const args = ["--json=2", "--json-key=encrypt", ...(password ? [`--password=${password}`] : []), "in.pdf"];
      let stdout: string;
      if (path === "retained") {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/scratch");
        await fs.writeFile("/in.pdf", input);
        const chunks: Uint8Array[] = [];
        const result = await createQpdfCommand().execute({
          command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
          signal: new AbortController().signal,
          stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
          stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
          stderr: { async write(bytes) { assert.fail(Buffer.from(bytes).toString()); } }
        });
        assert.equal(result.exitCode, 0);
        stdout = Buffer.concat(chunks).toString();
        assert.deepEqual(await fs.readdir("/scratch"), []);
      } else {
        const files = new Map([["in.pdf", input]]);
        const result = path === "sync" ? runQpdfCliSync(args, files) : await runQpdfCli(args, files);
        assert.equal(result.exitCode, 0, result.stderr);
        stdout = result.stdout;
      }
      // Native qpdf 12.4.2 encryption schema for plain and AES-256 inputs.
      assert.deepEqual(JSON.parse(stdout).encrypt, {
        capabilities: { accessibility: true, extract: true, modify: true, modifyannotations: true, modifyassembly: true, modifyforms: true, modifyother: true, printhigh: true, printlow: true },
        encrypted: Boolean(password), ownerpasswordmatched: password === "owner",
        parameters: password
          ? { P: -4, R: 6, V: 5, bits: 256, filemethod: "AESv3", key: null, method: "AESv3", streammethod: "AESv3", stringmethod: "AESv3" }
          : { P: 0, R: 0, V: 0, bits: 0, filemethod: "none", key: null, method: "none", streammethod: "none", stringmethod: "none" },
        recovereduserpassword: null, userpasswordmatched: password === "user"
      });
    });
  }
}
