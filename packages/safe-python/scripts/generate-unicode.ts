import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { compileUnicodeNames, compileIdentifierRanges } from "./unicode-data.js";
import { compileNormalizationData } from "./normalization-data.js";

const inputs = [
  ["extracted/DerivedName.txt", "0cc1469faa0c5518572ef93f4f457f93aa8a160ce320aad3793d85f4b435fd24"],
  ["NameAliases.txt", "9953f0fcebf5ea8091c5c581e4df0e43f20d2533c84ccca7987a9bb819a896a8"],
  ["DerivedCoreProperties.txt", "39d35161f2954497f69e08bdb9e701493f476a3d30222de20028feda36c1dabd"],
  ["UnicodeData.txt", "ff58e5823bd095166564a006e47d111130813dcf8bf234ef79fa51a870edb48f"],
  ["DerivedNormalizationProps.txt", "4d4c03892dea9146d674b686e495df2d55a28d071ac474041d73518f887abddc"]
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
const identifiers = compileIdentifierRanges(texts[2]);
const identifierOutput = `/*\n${license}\n*/\n` +
  "// Generated from Unicode 16.0.0 by scripts/generate-unicode.ts. Do not edit.\n" +
  `export const identifierStartRanges: readonly number[] = ${JSON.stringify(identifiers.start)};\n` +
  `export const identifierContinueRanges: readonly number[] = ${JSON.stringify(identifiers.continue)};\n`;
await writeFile(new URL("../src/identifier-data.ts", import.meta.url), identifierOutput);
console.log(`Generated ${identifiers.start.length / 2} start and ${identifiers.continue.length / 2} continuation ranges.`);
const normalization = compileNormalizationData(texts[3], texts[4]);
const normalizationOutput = `/*\n${license}\n*/\n` +
  "// Generated from Unicode 16.0.0 by scripts/generate-unicode.ts. Do not edit.\n" +
  `export const decompositions: Readonly<Record<number, readonly number[]>> = ${JSON.stringify(normalization.decompositions)};\n` +
  `export const combiningClasses: Readonly<Record<number, number>> = ${JSON.stringify(normalization.combiningClasses)};\n` +
  `export const compositions: Readonly<Record<number, number>> = ${JSON.stringify(normalization.compositions)};\n`;
await writeFile(new URL("../src/normalization-data.ts", import.meta.url), normalizationOutput);
console.log(`Generated ${Object.keys(normalization.decompositions).length} decompositions and ${Object.keys(normalization.compositions).length} compositions.`);
