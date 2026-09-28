import { perlSedEscapeCases, perlSedInvalidEscapeByteCases } from "./perl-sed-escape-fixtures.js";
import { perlSedVariableBehindCases, perlSedInvalidVariableBehindByteCases } from "./perl-sed-variable-behind-fixtures.js";
import { perlSedAtomicCases, perlSedInvalidAtomicByteCases } from "./perl-sed-atomic-fixtures.js";
import { perlSedNamedCases, perlSedInvalidNamedByteCases } from "./perl-sed-named-fixtures.js";
import { perlSedPosixCases, perlSedInvalidPosixByteCases } from "./perl-sed-posix-fixtures.js";
import { perlSedLookbehindCases, perlSedInvalidLookbehindByteCases } from "./perl-sed-lookbehind-fixtures.js";
import { perlSedCaptureCases, perlSedInvalidCaptureByteCases, perlSedCaptureHoldouts } from "./perl-sed-capture-fixtures.js";
import { expect, it } from "vitest";
import { perlSedCases, perlSedInvalidByteCases } from "./perl-sed-fixtures.js";
import proof from "../../../../docs/ssconvert/perl-sed-applicability.json" with { type: "json" };
import { quoteFormulaString } from "./serialization.js";
import { gnumericGrammar } from "./conventions.js";
import { perlSed } from "./functions/perl-sed.js";
import type { FunctionHost } from "./functions/types.js";
import type { CellValue } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";
import { perlSampleFunctions } from "./optional-providers.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { own() {}, signal: new AbortController().signal,
  runtimeFunctions: perlSampleFunctions, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 1000 } };
const decode = (hex: string) => new TextDecoder("UTF-8", { fatal: true }).decode(Uint8Array.from(hex.match(/../g) ?? [], value => parseInt(value, 16)));
const expression = (values: readonly string[]) => '=PERL_SED(' + values.map(value => quoteFormulaString(value, '"', gnumericGrammar)).join(',') + ')';
function calculate(formula: string, supplied = context) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "blank" } }
  ] }] }, supplied).sheets[0]!.cells[0]!.value;
}
it.each(proof.cases.filter(vector => "outputHex" in vector))("matches unmodified Perl scalar source $id", vector => {
  const formula = expression(vector.argumentsHex.map(decode));
  expect(calculate(formula)).toEqual({ kind: "string", value: decode(vector.outputHex!) });
});
it("keeps optional namespace and declared three-string arity", () => {
  expect(calculate('=PERL_SED("abc","b","d")', { ...context, runtimeFunctions: {} })).toEqual({ kind: "error", value: "#NAME?" });
  expect(calculate('=PERL_SED("abc","b")')).toEqual({ kind: "error", value: "#N/A" });
  expect(calculate('=PERL_SED("abc","b","d","extra")')).toEqual({ kind: "error", value: "#N/A" });
});

it.each(perlSedCases)("matches independent ordered regex source $id", vector => {
  const formula = expression(vector.argumentsHex.map(decode));
  expect(calculate(formula)).toEqual({ kind: "string", value: decode(vector.outputHex) });
});
it("keeps native C-string input boundaries and literal replacement output", () => {
  const values = ["abc\0b", "b", "$1\0tail"];
  const book = { sheets: [{ id: "s", name: "S", cells: [
    ...values.map((value, column) => ({ row: 0, column, value: { kind: "string" as const, value } })),
    { row: 0, column: 3, value: { kind: "blank" as const }, formula: "=PERL_SED(A1,B1,C1)", formulaDirty: true }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[3]!.value).toEqual({ kind: "string", value: "a$1c" });
});
it("refuses unsafe or unqualified pattern execution explicitly", () => {
  for (const pattern of ['(?{die "owned unsafe code"})', '(??{die "owned unsafe code"})', '(a)\\11', '(?<=a+)b'])
    expect(() => calculate(expression(["aab", pattern, "X"]))).toThrow("PERL_SED pattern syntax or diagnostic");
});
it("bounds output amplification and ordered backtracking work", () => {
  expect(() => calculate('=PERL_SED("aaaa","","XXXXXXXX")', { ...context, limits: { ...context.limits, outputBytes: 8 } })).toThrow("text limit exceeded");
  expect(() => calculate('=PERL_SED("aaaaaaaaaaaaaaaaaaaa","(a|aa)*b","X")', { ...context, limits: { ...context.limits, workbookWork: 200 } })).toThrow("work limit");
  const host = { context: { ...context, limits: { ...context.limits, inputBytes: 3 } }, tick() {},
    scalar(value: CellValue) { return value; } } as unknown as FunctionHost;
  expect(() => perlSed(["abc", "a", "X"].map(value => ({ kind: "string", value })), host)).toThrow("input byte limit");
});
it("observes cancellation within matching without more ticks", () => {
  const signal = new AbortController().signal; let checks = 0;
  const original = signal.throwIfAborted.bind(signal);
  signal.throwIfAborted = () => { original(); if (++checks === 100) throw new DOMException("Aborted", "AbortError"); };
  expect(() => calculate('=PERL_SED("aaaaaaaaaaaaaaaaaaaa","(a|aa)*b","X")', { ...context, signal })).toThrow("Aborted");
  expect(checks).toBe(100);
});

it.each(perlSedInvalidByteCases)("preserves native native byte-result representation $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "byte-string", value: vector.outputHex });
});

it.each(perlSedCaptureCases)("matches independent native capture state $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});

it.each(perlSedInvalidCaptureByteCases)("preserves native capture byte result $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "byte-string", value: vector.outputHex });
});

it.each(perlSedCaptureHoldouts)("matches independent capture holdout $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});

it.each(perlSedLookbehindCases)("matches independent fixed lookbehind $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});
it.each(perlSedInvalidLookbehindByteCases)("preserves native lookbehind byte result $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "byte-string", value: vector.outputHex });
});

it.each(perlSedPosixCases)("matches native POSIX class $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});
it.each(perlSedInvalidPosixByteCases)("preserves native POSIX byte result $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "byte-string", value: vector.outputHex });
});

it("refuses unknown, truncated and native-reserved POSIX syntax explicitly", () => {
  for (const pattern of ['[[:bogus:]]', '[[:digit:]', '[[.a.]]', '[[=a=]]'])
    expect(() => calculate(expression(['aaa123', pattern, 'X']))).toThrow("PERL_SED pattern syntax or diagnostic");
});

it.each(perlSedNamedCases)("matches native named capture $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});
it.each(perlSedInvalidNamedByteCases)("preserves native named-capture byte result $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "byte-string", value: vector.outputHex });
});

it.each(perlSedAtomicCases)("matches native atomic and possessive state $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});
it.each(perlSedInvalidAtomicByteCases)("preserves native atomic byte result $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "byte-string", value: vector.outputHex });
});

it.each(perlSedVariableBehindCases)("matches native bounded variable lookbehind $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});
it.each(perlSedInvalidVariableBehindByteCases)("preserves native variable-lookbehind byte result $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "byte-string", value: vector.outputHex });
});

it.each(perlSedEscapeCases)("matches native escape and possessive state $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "string", value: decode(vector.outputHex) });
});
it.each(perlSedInvalidEscapeByteCases)("preserves native escape byte result $id", vector => {
  expect(calculate(expression(vector.argumentsHex.map(decode)))).toEqual({ kind: "byte-string", value: vector.outputHex });
});


// Checked against Gnumeric 1.12.61's unmodified func_perl_sed on Perl 5.34.1.
// Sample SHA256: 73bfafc72fe65a516eed8708395738a0fbfc11f607321a08bddd456ca572fe71.
// Scalar component controls; this does not qualify Gnumeric plugin activation.
const modifierCases = [
  [" a", "(?xx)[ a]", " X"],
  [" a", "(?xx:[ a])", " X"],
  ["\ta", "(?xx)[\ta]", "\tX"],
  ["ab", "(?x)a\vb", "X"],
  ["ab", "(?xx)a\vb", "X"],
  [" a", "(?x)[ a]", "XX"],
  [" a", "(?xx)[\\ a]", "XX"],
  ["\na", "(?xx)[\na]", "XX"],
  ["\va", "(?xx)[\va]", "XX"],
  [" a", "(?xx)(?-x)[ a]", "XX"],
  [" a", "(?xx)(?x)[ a]", "XX"],
  [" a", "(?xx)(?^:[ a])", "XX"],
  [" a", "(?xx)(?^xx:[ a])", " X"],
  ["a a", "(?xx:[ a]) [ a]", "X"],
  ["a a", "(?xx)[ a](?-x: )[ a]", "X"],
  [" a", "(?xx)[ a - c ]", " X"],
  ["ab", "(?xx)[a b]+", "X"],
  [" a", "(?xx)[\\x20a]", "XX"],
  [" a", "(?xxx)[ a]", " X"],
  ["a b", "(?xx)a\\ b", "X"],
  ["a#b", "(?xx)a\\#b", "X"],
  [" a", "(?xx)[ ^a]", "Xa"],
  ["Aa", "(?i)(?^:a)", "AX"],
  [" a", "(?xx)(?^)[ a]", "XX"],
  [" a", "(?xx)[ a- ]", " X"],
  ["a", "(?a:a)", "X"],
  ["a", "(?aa:a)", "X"],
  ["a", "(?d:a)", "X"],
  ["a", "(?a)(?d:a)", "X"],
  ["a", "(?-:a)", "X"],
] as const;
it.each(modifierCases)("matches Perl embedded modifier semantics %j %j", (input, pattern, output) => {
  expect(calculate(expression([input, pattern, "X"]))).toEqual({ kind: "string", value: output });
});
it.each(["(?ad)a", "(?da)a", "(?-d:a)", "(?-a:a)", "(?aaa:a)", "(?dd:a)", "(?aiaa:a)", "(?^d:a)", "(?^i-x:a)"])(
  "diagnoses malformed embedded modifiers %s", pattern => {
    expect(() => calculate(expression(["a", pattern, "X"]))).toThrow("PERL_SED embedded modifier");
  }
);

it("ignores raw-byte next-line pattern whitespace in extended modes", () => {
  const host = { context, tick() {}, scalar(value: CellValue) { return value; } } as unknown as FunctionHost;
  for (const prefix of ["283f7829", "283f787829"])
    expect(perlSed([{ kind: "string", value: "ab" }, { kind: "byte-string", value: prefix + "618562" }, { kind: "string", value: "X" }], host))
      .toEqual({ kind: "string", value: "X" });
});


it.each(["(?i)", "(?-i)", "(?^)", "(?x)", "(?xx)", "(?-)"])(
  "rejects quantifiers following bare modifier %s", modifier => {
    for (const quantifier of ["*", "+", "?"])
      for (const prefix of ["", "a"])
        expect(() => calculate(expression(["aa", prefix + modifier + quantifier + "a", "X"])))
          .toThrow("PERL_SED pattern syntax or diagnostic");
  }
);
it.each(["(?x) # comment\n +a", "(?xx) \t?a"])(
  "rejects bare modifier quantifiers after extended whitespace %s", pattern => {
    expect(() => calculate(expression(["a", pattern, "X"]))).toThrow("PERL_SED pattern syntax or diagnostic");
  }
);
it.each(["(?i:a)+", "(?^:a){1,2}", "(?x:a){1}", "(?xx:a)+", "(?i)a+", "(?i)(?:)+a"])(
  "keeps scoped groups and subsequent atoms quantifiable %s", pattern => {
    expect(calculate(expression(["a", pattern, "X"]))).toEqual({ kind: "string", value: "X" });
  }
);
// Outputs checked independently with Perl's byte-mode s/$pattern/X/g.
it.each([
  ["\t\n\r", "[\\t-\\r]", "XXX"],
  ["abcd", "[\\x61-\\x63]", "XXXd"],
  ["abcd", "[\\x{61}-\\x{63}]", "XXXd"],
  ["-./01", "[\\--0]", "XXXX1"],
  ["09:AZ[\\]^", "[0-\\]]", "XXXXXXXX^"],
  ["\x01\x1f !", "[\\000-\\037]", "XX !"],
  ["abcd", "[\\o{141}-\\o{143}]", "XXXd"],
  ["\x01\x02\x03\x04", "[\\cA-\\cC]", "XXX\x04"],
  ["[\\]^", "[\\\\-\\]]", "[XX^"],
  ["aAbBcCdD", "(?i)[\\x61-\\x63]", "XXXXXXdD"],
  ["abcd", "[^\\x61-\\x63]", "abcX"],
  ["abcd", "(?xx)[ \\x61 - \\x63 ]", "XXXd"],
  ["-a", "[\\x61-]", "XX"],
  ["abcd", "[a-\\x63]", "XXXd"],
  ["abcd", "[\\x61-c]", "XXXd"],
])("matches decoded literal class range %j %j", (input, pattern, output) => {
  expect(calculate(expression([input, pattern, "X"]))).toEqual({ kind: "string", value: output });
});
it.each(["[\\x63-\\x61]", "[\\r-\\t]", "[\\d-a]", "[a-\\w]", "[[:digit:]-a]", "[a-\\x{100}]"])(
  "refuses descending or nonliteral byte range %s", pattern => {
    expect(() => calculate(expression(["abc", pattern, "X"]))).toThrow("PERL_SED pattern syntax or diagnostic");
  }
);

// Perl 5.34.1 treats these braces as literal text, not as a quantifier.
it.each(["(?i)", "(?-i)", "(?^)", "(?x)", "(?xx)"])(
  "preserves literal brace text after bare modifier %s", modifier => {
    for (const braces of ["{1}", "{1,2}", "{1,}"])
      for (const prefix of ["", "a"]) {
        const pattern = prefix + modifier + braces + "a";
        expect(calculate(expression(["aa", pattern, "X"]))).toEqual({ kind: "string", value: "aa" });
        expect(calculate(expression([prefix + braces + "a", pattern, "X"]))).toEqual({ kind: "string", value: "X" });
      }
    if (modifier === "(?x)" || modifier === "(?xx)")
      expect(calculate(expression(["{1}a", modifier + " # comment\n {1}a", "X"])))
        .toEqual({ kind: "string", value: "X" });
  }
);
