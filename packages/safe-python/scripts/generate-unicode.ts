import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { compileUnicodeNames } from "./unicode-data.js";

const inputs = [
  ["extracted/DerivedName.txt", "0cc1469faa0c5518572ef93f4f457f93aa8a160ce320aad3793d85f4b435fd24"],
  ["NameAliases.txt", "9953f0fcebf5ea8091c5c581e4df0e43f20d2533c84ccca7987a9bb819a896a8"]
];
const texts = await Promise.all(inputs.map(async ([path, hash]) => {
  const response = await fetch(`https://www.unicode.org/Public/16.0.0/ucd/${path}`);
  if (!response.ok) throw new Error(`Unicode download failed: ${response.status} ${path}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== hash) {
    throw new Error(`Unicode input hash mismatch: ${path}`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}));
const { names, ranges } = compileUnicodeNames(texts[0], texts[1]);
const license = await readFile(new URL("../UNICODE-LICENSE.txt", import.meta.url), "utf8");
const output = `/*\n${license}\n*/\n` +
  "// Generated from Unicode 16.0.0 by scripts/generate-unicode.ts. Do not edit.\n" +
  `export const unicodeNamedCharacters: string = ${JSON.stringify(names)};\n` +
  `export const unicodeNameRanges: ReadonlyArray<readonly [string, number, number]> = ${JSON.stringify(ranges)};\n`;
await writeFile(new URL("../src/unicode-names-data.ts", import.meta.url), output);
console.log(`Generated ${names.split("\n").length - 1} names and ${ranges.length} ranges (${output.length} characters).`);
