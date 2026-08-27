import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const preserved = JSON.parse(readFileSync(new URL("./preserved-source.json", import.meta.url), "utf8")) as {
  files: Record<string, string>;
  sections: { file: string; from: string; sha256: string }[];
};
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const source = (name: string): string => readFileSync(new URL(`../../../../src/commands/column/${name}`, import.meta.url), "utf8");

test("padding evolution leaves API/options/scalar policy byte-identical to the verifier source", () => {
  for (const [name, sha256] of Object.entries(preserved.files)) assert.equal(hash(source(name)), sha256, name);
});

test("padding evolution preserves verifier forwarding/cleanup/fill/execute sections byte-for-byte", () => {
  for (const section of preserved.sections) {
    const text = source(section.file), start = text.indexOf(section.from);
    assert.ok(start >= 0);
    assert.equal(hash(text.slice(start)), section.sha256, section.file);
  }
});
