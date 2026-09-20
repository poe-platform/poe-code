import { readFileSync, writeFileSync } from "node:fs";

// Input: https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt
// Data license: ../UNICODE-LICENSE.txt. Generation has no runtime dependency.
const categories = [
  "Cn",
  "Lu",
  "Ll",
  "Lt",
  "Lm",
  "Lo",
  "Mn",
  "Mc",
  "Me",
  "Nd",
  "Nl",
  "No",
  "Pc",
  "Pd",
  "Ps",
  "Pe",
  "Pi",
  "Pf",
  "Po",
  "Sm",
  "Sc",
  "Sk",
  "So",
  "Zs",
  "Zl",
  "Zp",
  "Cc",
  "Cf",
  "Cs",
  "Co"
];
const ranges = [];
let first;
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line) continue;
  const [point, name, category] = line.split(";");
  const value = Number.parseInt(point, 16);
  const id = categories.indexOf(category);
  if (id < 0) throw new Error("Unknown category: " + category);
  if (name.endsWith(", First>")) {
    first = value;
    continue;
  }
  const start = name.endsWith(", Last>") ? first : value;
  if (start === undefined) throw new Error("Missing range start");
  const previous = ranges.at(-1);
  if (previous && previous[1] + 1 === start && previous[2] === id) previous[1] = value;
  else ranges.push([start, value, id]);
  first = undefined;
}
const output =
  "// Generated from Unicode 17.0.0 UnicodeData.txt; see UNICODE-LICENSE.txt.\n" +
  "// Regenerate with scripts/generate-unicode.mjs; IDs follow GENERAL_CATEGORIES.\n" +
  "pub(super) const GENERAL_CATEGORIES: &[&str] = &[" +
  categories.map(JSON.stringify).join(", ") +
  "];\n" +
  "pub(super) const CATEGORY_RANGES: &[(u32, u32, u8)] = &[\n" +
  ranges
    .map(
      ([start, end, id]) =>
        "    (0x" + start.toString(16) + ", 0x" + end.toString(16) + ", " + id + "),"
    )
    .join("\n") +
  "\n];\n";
writeFileSync(new URL("../src/unicode_categories.rs", import.meta.url), output);
