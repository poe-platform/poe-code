import { translitCases } from "./translit-fixtures.js";
import { cases } from "./fixtures.js";
import { reviewCases } from "./review-fixtures.js";
// Unicode policy deliberately rejects legacy glibc extended UTF-8 and resets file BOM state.
// Native capture fixtures remain unchanged; these are the current Unicode policy expectations.
export const unicodePolicy: Record<string, { exitCode: number; stdoutHex: string; stderrHex: string }> = {
  "replay:extended-utf8": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "replay:above-unicode": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "above-unicode-utf16:strict": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "above-unicode-utf16:discard": { exitCode: 1, stdoutHex: "", stderrHex: "" },
  "BE-then-LE": { exitCode: 0, stdoutHex: "4241", stderrHex: "" },
  "BE-then-bare-LE": { exitCode: 0, stdoutHex: "4243", stderrHex: "" },
  "BE-empty-LE": { exitCode: 0, stdoutHex: "4241", stderrHex: "" },
  "BOM-only-BE-LE": { exitCode: 0, stdoutHex: "41", stderrHex: "" },
  "six-valid": { exitCode: 1, stdoutHex: "", stderrHex: "" },
  "one-extended:ASCII": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "one-extended:UTF-16": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "one-extended:UTF-16LE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "one-extended:UTF-16BE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "two-extended:ASCII": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "two-extended:UTF-16": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "two-extended:UTF-16LE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "two-extended:UTF-16BE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "lead-extended:ASCII": { exitCode: 1, stdoutHex: "41", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20310a" },
  "lead-extended:UTF-16": { exitCode: 1, stdoutHex: "fffe4100", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20310a" },
  "lead-extended:UTF-16LE": { exitCode: 1, stdoutHex: "4100", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20310a" },
  "lead-extended:UTF-16BE": { exitCode: 1, stdoutHex: "0041", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20310a" },
  "extended-separated:ASCII": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "extended-separated:UTF-16": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "extended-separated:UTF-16LE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "extended-separated:UTF-16BE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "above-31bit-valid-max:ASCII": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "above-31bit-valid-max:UTF-16": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "above-31bit-valid-max:UTF-16LE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "above-31bit-valid-max:UTF-16BE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "utf16-recursive-bom:8158": { exitCode: 1, stdoutHex: "fffe" + "4100".repeat(8158), stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20383135380a" },
  "utf16-all-extended:8158": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "utf16-recursive-bom:8159": { exitCode: 1, stdoutHex: "fffe" + "4100".repeat(8159), stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20383135390a" },
  "utf16-all-extended:8159": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "utf16-recursive-bom:8160": { exitCode: 1, stdoutHex: "fffe" + "4100".repeat(8160), stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20383136300a" },
  "utf16-all-extended:8160": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "utf16-recursive-bom:8161": { exitCode: 1, stdoutHex: "fffe" + "4100".repeat(8161), stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20383136310a" },
  "utf16-all-extended:8161": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "utf16-recursive-bom:16383": { exitCode: 1, stdoutHex: "fffe" + "4100".repeat(16383), stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e2031363338330a" },
  "utf16-all-extended:16383": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "utf16-recursive-bom:16384": { exitCode: 1, stdoutHex: "fffe" + "4100".repeat(16384), stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e2031363338340a" },
  "utf16-all-extended:16384": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "invalid:f4908080ff41:strict": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "invalid:f4908080ff41:discard": { exitCode: 0, stdoutHex: "41", stderrHex: "" },
  "representable-utf8": { exitCode: 1, stdoutHex: "003f73734555523f", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e2031350a" },
  "representable-utf8-identity": { exitCode: 1, stdoutHex: "00efbbbfc3a9c39fe282acf09f9880", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e2031350a" },
  "multifile:extended,extended": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "multifile:lead,extended": { exitCode: 1, stdoutHex: "fffe4100", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20310a" },
  "multifile:good,extended": { exitCode: 1, stdoutHex: "fffe4100", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "extended-31bit:UTF-16LE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
  "extended-31bit:UTF-16BE": { exitCode: 1, stdoutHex: "", stderrHex: "69636f6e763a20696c6c6567616c20696e7075742073657175656e636520617420706f736974696f6e20300a" },
};

// Discarded invalid input remains a failure even when later output is valid.
// Keep native captures intact and override only the portable status contract.
const discardedInputCases = new Set([
  "invalid:41ff42:discard",
  "invalid:f4908080ff41:discard",
  "invalid:41c3a9ff42:discard",
  "utf16-invalid-source",
  "replay:bad-utf8-c",
  "replay:unrepresentable-c",
  "replay:surrogate-c",
  "replay:utf16-bad-pair-c",
  "illegal-then-good:discard",
  "bad-after-prefix:discard",
  "bad-then-prefix:discard",
  "ascii-bad-prefix:discard",
  "utf16-two-highs:discard",
  "output-boundary-invalid:32767",
  "output-boundary-invalid:32768",
  "output-boundary-invalid:32769",
  "mixed-head-tail-8158",
  "mixed-tail-head-8158",
  "mixed-tail-head-8159",
  "mixed-head-tail-8160",
  "mixed-tail-head-8160",
  "mixed-head-tail-32767",
  "mixed-tail-head-32767",
  "mixed-head-tail-32768",
  "mixed-tail-head-32768",
  "flush-ASCII-ff",
  "flush-UTF-8-ff",
  "flush-UTF-16-ff",
  "flush-UTF-16LE-ff",
  "six-invalid",
  "six-utf16"
]);
for (const fixture of [...cases, ...reviewCases, ...translitCases]) {
  if (!discardedInputCases.has(fixture.name)) continue;
  const previous = unicodePolicy[fixture.name];
  const stdoutHex = previous?.stdoutHex ?? fixture.stdoutHex;
  if (stdoutHex === undefined) throw new Error(`Missing Unicode policy output: ${fixture.name}`);
  unicodePolicy[fixture.name] = {
    stdoutHex,
    stderrHex: previous?.stderrHex ?? ("portableStderrHex" in fixture ? fixture.portableStderrHex : fixture.stderrHex),
    exitCode: 1,
  };
}
