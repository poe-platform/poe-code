import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {compileNormalizationData} from "./normalization-data.js";

// Unicode 3.2 is required by CPython's stringprep/IDNA compatibility database;
// it does not replace the pinned Unicode 16 identifier or string properties.
const inputs = [
  ["UnicodeData-3.2.0.txt", "5e444028b6e76d96f9dc509609c5e3222bf609056f35e5fcde7e6fb8a58cd446"],
  ["CompositionExclusions-3.2.0.txt", "1d3a450d0f39902710df4972ac4a60ec31fbcb54ffd4d53cd812fc1200c732cb"]
];
const [unicodeData, exclusions] = await Promise.all(inputs.map(async ([name, hash]) => {
  const response = await fetch(`https://www.unicode.org/Public/3.2-Update/${name}`);
  if (!response.ok) throw new Error(`Unicode download failed: ${response.status} ${name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error(`Unicode hash mismatch: ${name}`);
  return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
}));
const properties = exclusions.split("\n").map(line => line.split("#", 1)[0].trim())
  .filter(Boolean).map(point => `${point}; Full_Composition_Exclusion`).join("\n");
const tables = compileNormalizationData(unicodeData, properties);
// The old exclusion file lists only explicit exclusions. Non-starter and
// singleton decompositions are also excluded from canonical composition.
for (const key of Object.keys(tables.compositions)) {
  if (tables.combiningClasses[Math.floor(Number(key) / 0x110000)]) delete tables.compositions[Number(key)];
}
const license = await readFile(new URL("../UNICODE-LICENSE.txt", import.meta.url), "utf8");
const output = `/*\n${license}\n*/\n` +
  "// Generated from hash-pinned Unicode 3.2 inputs by scripts/generate-normalization-unicode32.ts.\n" +
  'import type {NormalizationTables} from "./normalization.js";\n' +
  `export const unicode32Normalization: NormalizationTables = ${JSON.stringify(tables)};\n`;
await writeFile(new URL("../src/normalization-unicode32-data.ts", import.meta.url), output);
console.log(`Generated ${Object.keys(tables.decompositions).length} decompositions, ${Object.keys(tables.combiningClasses).length} combining classes and ${Object.keys(tables.compositions).length} compositions.`);
