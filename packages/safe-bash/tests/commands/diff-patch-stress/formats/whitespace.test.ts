import assert from "node:assert/strict";
import test from "node:test";
import { labels, run } from "./helpers.js";

interface WhitespaceCase { name: string; old: string; next: string; all: boolean; change: boolean }
const cases: readonly WhitespaceCase[] = [
  { name: "leading-absent-present", old: "word\n", next: " word\n", all: true, change: false },
  { name: "leading-nonempty", old: " word\n", next: "\t  word\n", all: true, change: true },
  { name: "trailing-absent-present", old: "word\n", next: "word \t\r\n", all: true, change: true },
  { name: "internal-absent-present", old: "twoWords\n", next: "two Words\n", all: true, change: false },
  { name: "internal-nonempty", old: "two Words\n", next: "two\t   Words\n", all: true, change: true },
  { name: "empty-line-nonempty-space", old: "\n", next: " \t\n", all: true, change: true },
  { name: "empty-file-whitespace-line", old: "", next: " \n", all: false, change: false },
  { name: "empty-file-incomplete-space", old: "", next: " ", all: false, change: false },
  { name: "extra-blank-line", old: "word\n", next: "word\n\n", all: false, change: false },
  { name: "line-boundary", old: "two\nWords\n", next: "two Words\n", all: false, change: false },
  { name: "eof-newline-ignored", old: "word", next: "word\n", all: true, change: true },
  { name: "eof-space-newline-ignored", old: "word \t", next: "word\n", all: true, change: true },
  { name: "eof-actual-change", old: "word", next: "changed\n", all: false, change: false },
  { name: "eof-blank-to-incomplete", old: "\n", next: " ", all: true, change: true },
  { name: "vertical-tab", old: "two Words\n", next: "two\vWords\n", all: true, change: true },
  { name: "form-feed", old: "two Words\n", next: "two\fWords\n", all: true, change: true },
  { name: "carriage-return", old: "two Words\n", next: "two\rWords\n", all: true, change: true },
  { name: "crlf-lf", old: "word\r\n", next: "word\n", all: true, change: true },
  { name: "unicode-nbsp-significant", old: "twoWords\n", next: "two\u00a0Words\n", all: false, change: false },
  { name: "unicode-em-space-significant", old: "twoWords\n", next: "two\u2003Words\n", all: false, change: false },
  { name: "unicode-line-separator-significant", old: "twoWords\n", next: "two\u2028Words\n", all: false, change: false },
  { name: "unicode-nel-significant", old: "twoWords\n", next: "two\u0085Words\n", all: false, change: false },
  { name: "bom-significant", old: "word\n", next: "\ufeffword\n", all: false, change: false },
  { name: "embedded-bom-significant", old: "twoWords\n", next: "two\ufeffWords\n", all: false, change: false },
  { name: "unicode-normalization-significant", old: "é\n", next: "e\u0301\n", all: false, change: false },
  { name: "case-significant", old: "word\n", next: "Word\n", all: false, change: false },
  { name: "punctuation-significant", old: "word;\n", next: "word:\n", all: false, change: false },
  { name: "whitespace-not-reorder", old: "one two\n", next: "two one\n", all: false, change: false },
];

for (const entry of cases) for (const flag of ["-w", "-b"] as const) {
  const expected = entry[flag === "-w" ? "all" : "change"] ? 0 : 1;
  for (const format of [[], ["-C3"]]) test(`whitespace ${format[0] ?? "normal"}/${flag}/${entry.name}`, async () => {
    const args = [...format, flag, ...labels, "old", "new"];
    const result = await run("diff", args, { files: { old: entry.old, new: entry.next } });
    assert.equal(result.exitCode, expected, result.stderr);
  });
}

for (const flag of ["-w", "-b"]) for (const format of [[], ["-C0"], ["-C1"], ["-C32"], ["-U3"]]) {
  test(`mixed actual changes preserve each original side ${flag}/${format[0] ?? "normal"}`, async () => {
    const old = "\ufeffstart\t  here \r\nold \t value\nend\v here \t\nlast";
    const next = "\ufeffstart here\nNEW\tvalue\nend here\nlast\n";
    const args = [...format, flag, ...labels, "old", "new"];
    const result = await run("diff", args, { files: { old, new: next } });
    assert.equal(result.exitCode, 1, result.stderr);
    assert(result.stdout.includes("old \t value\n"));
    assert(result.stdout.includes("NEW\tvalue\n"));
  });
}

test("static context -w output retains old and new context bytes independently", async () => {
  const result = await run("diff", ["-c", "-w", ...labels, "old", "new"], {
    files: { old: "keep \t here\nold\nend \t\n", new: "keep here\nnew\nend\n" },
  });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "*** target\n--- target\n***************\n*** 1,3 ****\n  keep \t here\n! old\n  end \t\n--- 1,3 ----\n  keep here\n! new\n  end\n");
});

for (const flags of [["-w", "-b"], ["-b", "-w"], ["-wb"], ["-bw"], ["--ignore-all-space", "--ignore-space-change"]]) {
  test(`all-space dominates flag ordering ${flags.join(" ")}`, async () => {
    const result = await run("diff", [...flags, "old", "new"], { files: { old: "abc\n", new: " a b c \n" } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
  });
}

const looseCases = [
  { name: "nonempty-blanks", old: "two Words\n", target: "two\t  Words\n", accept: true },
  { name: "leading-blanks", old: " two\n", target: "\t  two\n", accept: true },
  { name: "missing-internal-blanks", old: "two Words\n", target: "twoWords\n", accept: false },
  { name: "missing-leading-blanks", old: " two\n", target: "two\n", accept: false },
  { name: "extra-internal-blanks", old: "twoWords\n", target: "two Words\n", accept: false },
  { name: "nonblank-change", old: "two Words\n", target: "two Words!\n", accept: false },
  { name: "unicode-space-not-blank", old: "two Words\n", target: "two\u00a0Words\n", accept: false },
  { name: "bom-not-blank", old: "twoWords\n", target: "\ufefftwoWords\n", accept: false },
];

for (const entry of looseCases) for (const format of [[], ["-C3"], ["-U3"]]) {
  test(`patch -l ${format[0] ?? "normal"}/${entry.name}`, async () => {
    const old = `head \t value\n${entry.old}tail \t value\n`;
    const target = `head  value\n${entry.target}tail  value\n`;
    const next = "head \t value\nreplacement \t bytes\ntail \t value\n";
  });
}
