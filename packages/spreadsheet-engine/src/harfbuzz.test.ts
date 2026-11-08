import { it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyArtifact } from "../scripts/harfbuzz/verify.mjs";

const repository = new URL("../../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../scripts/harfbuzz/sources.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("./rendering/print/harfbuzz/data.ts", import.meta.url), "utf8");
const files = new Map<string, Uint8Array>(manifest.inputs.map((input: { path: string }) => [input.path, readFileSync(new URL(input.path, repository))]));
const verify = (changes = {}) => verifyArtifact({ source, manifest, files, ...changes });

  it("authenticates the portable artifact and its build inputs", () => {
    const result = verify();
    assert.equal(result.byteLength, 553970);
    assert.equal(result.initialMemoryBytes, 262144);
    assert.equal(result.maximumMemoryBytes, 2147483648);
  });
