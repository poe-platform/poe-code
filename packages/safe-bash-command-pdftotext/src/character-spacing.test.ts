import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftotextCommand, extractPdfToTextBytes } from "./index.js";

const fixture = readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-bug1873345.pdf", import.meta.url));
for (const flags of [[], ["-raw"], ["-layout"], ["-bbox"], ["-bbox-layout"]]) {
  it(`preserves character-spacing word boundaries with ${flags.join(" ") || "default output"}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.pdf", fixture);
    const args = createCommandArguments([...flags, "/input.pdf", "-"]);
    const chunks: Uint8Array[] = [];
    const result = await createPdftotextCommand().execute({
      command: "pdftotext", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { assert.fail(new TextDecoder().decode(bytes)); } },
    });
    assert.equal(result.exitCode, 0);
    const direct = extractPdfToTextBytes(fixture, flags);
    assert.equal(direct.exitCode, 0);
    for (const output of [Buffer.concat(chunks).toString(), direct.output]) {
      assert.ok(!output.includes("Asection"));
      if (flags[0]?.startsWith("-bbox")) {
        assert.match(output, /<word xMin="286\.021020"[^>]*xMax="294\.890118"[^>]*>A<\/word>/);
        assert.match(output, /<word xMin="299\.023578"[^>]*xMax="339\.914955"[^>]*>section<\/word>/);
      } else assert.ok(output.includes("1. A section"));
    }
  });
}
