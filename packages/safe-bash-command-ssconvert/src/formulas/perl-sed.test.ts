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

// Native Perl 5.34.1 byte strings; perlre 5.36.0 conditional-expression grammar.
it.each([
  ["numbered", "ab c ac", "(a)?(?(1)b|c)", "X X aX"],
  ["empty capture", "b c", "()(?(1)b|c)", "X c"],
  ["empty else", "b ab", "(a)?(?(1)b)", "XbX XX"],
  ["named angle", "ab c ac", "(?<pick>a)?(?(<pick>)b|c)", "X X aX"],
  ["named quoted", "ab c ac", "(?<pick>a)?(?('pick')b|c)", "X X aX"],
  ["duplicate name", "ax bx c", "(?:(?<pick>a)|(?<pick>b))?(?(<pick>)x|c)", "X X X"],
  ["forward number", "ba aa", "(?(1)a|b)(a)", "X aa"],
  ["forward name", "ba aa", "(?(<pick>)a|b)(?<pick>a)", "X aa"],
  ["nested", "ab ad c ac", "(a)?(?(1)(b)?(?(2)c|d)|c)", "ab X X aX"],
  ["exclusive branch", "ac c ab", "(a)(?(1)b|c)", "ac c X"],
  ["backtracking", "ac c ab", "(a)?(?(1)b|ac)", "X c X"],
  ["branch captures", "abb cc abcc", "(a)?(?(1)(b)|(c))\\2", "X cc abcc"],
  ["repeated", "abcc cab aab", "(?:(a)?(?(1)b|c))+", "X X aX"],
  ["inside lookbehind", "abx cx ax", "(a)?(?<=(?(1)b|c))x", "abx cX ax"],
  ["prior assertion capture", "ab c", "(?=(a))?(?(1)ab|c)", "X X"],
  ["scoped flags", "AB c", "(?i:(a)?(?(1)b|c))", "X X"],
  ["lookahead", "ab c ac", "(?(?=a)ab|c)", "X X aX"],
  ["negative lookahead", "ab c ac", "(?(?!a)c|ab)", "X X aX"],
  ["lookbehind", "ab cb", "(?(?<=a)b|c)", "aX Xb"],
  ["negative lookbehind", "ab cb", "(?(?<!a)c|b)", "aX Xb"],
  ["assertion capture", "ab c", "(?(?=(a))\\1b|c)", "X X"],
  ["exclusive assertion", "ac c ab", "(?(?=a)ab|ac)", "ac c X"]
])("matches native conditional %s", (_label, source, pattern, expected) => {
  expect(calculate(expression([source!, pattern!, "X"]))).toEqual({ kind: "string", value: expected });
});
it("keeps conditional replacements literal and malformed UTF-8 results lossless", () => {
  expect(calculate(expression(["ab c", "(a)?(?(1)b|c)", "$1\\n"])))
    .toEqual({ kind: "string", value: "$1\\n $1\\n" });
  expect(calculate(expression(["é", "(\\xC3)(?(1)|.)", "X"])))
    .toEqual({ kind: "byte-string", value: "58a9" });
});
it.each(["(?(0)a|b)", "(?(<absent>)a|b)", "(a)(?(1)b|c|d)",
  "(a)?(?(-1)b|c)", "(?(+1)a|b)(a)", "(?<pick>a)?(?(pick)b|c)", "(?(?{1})a|b)"])
  ("refuses unqualified conditional syntax %s", pattern => {
    expect(() => calculate(expression(["ab", pattern, "X"]))).toThrow("PERL_SED");
  });

// regcomp.c emits GROUPP for any nonzero decimal condition through I32_MAX.
it.each([
  ["a b", "(?(1)a|b)", "a X"],
  ["a b ab", "(?(2)a|b)(a)?", "a X aX"],
  ["ba aa", "(?(2)a|b)(a)", "X aa"],
  ["ac ad bc bd", "(?|(a)|(b))(?(2)c|d)", "ac X bc X"],
  ["a b", "(?(2147483647)a|b)", "a X"],
  ["ab", "(?(9)x)", "XaXbX"],
  ["a b c", "(?(2)x|(?(3)a|b))", "a X c"]
])("treats absent numeric conditional captures as false: %s %s", (source, pattern, expected) => {
  expect(calculate(expression([source!, pattern!, "X"]))).toEqual({ kind: "string", value: expected });
});
it("keeps absent numeric conditional raw-byte results", () => {
  expect(calculate(expression(["é", "(?(9)x|\\xC3)", "X"]))).toEqual({ kind: "byte-string", value: "58a9" });
});
it.each(["(a)?(?(01)b|c)", "(a)?(?(0001)b|c)", "(?(2147483648)a|b)"])
  ("refuses native-invalid numeric conditional spelling %s", pattern => {
    expect(() => calculate(expression(["ac c", pattern, "X"]))).toThrow("PERL_SED");
  });

// Perl 5.34.1 regcomp.c resets each branch's capture index and retains its maximum.
it.each([
  ["numbered", "aa bb ab", "(?|(a)|(b))\\1", "X X ab"],
  ["before and after", "xaazz xbbzz", "(x)(?|(a)|(b))\\2(z)\\3", "X X"],
  ["uneven", "aazz bccz", "(?|(a)|(b)(c))\\1?\\2?(z)\\3?", "X X"],
  ["nested", "aa bb cc", "(?|(a)|(?|(b)|(c)))\\1", "X X X"],
  ["same name", "aa bb ab", "(?|(?<pick>a)|(?<pick>b))\\k<pick>", "X X ab"],
  ["alias name", "aa bb ab", "(?|(?<left>a)|(?<right>b))\\k<right>", "X X ab"],
  ["crossed names", "xyxx zwzz xyxy zwzw", "(?|(?<a>x)(?<b>y)|(?<b>z)(?<a>w))\\k<a>\\k<b>", "xyxx zwzz X X"],
  ["number condition", "ac bc c", "(?|(a)|(b))?(?(1)c|d)", "X X c"],
  ["name condition", "ac bc c", "(?|(?<a>a)|(?<b>b))?(?(<b>)c|d)", "X X c"],
  ["relative reference", "aa bb ab", "(?|(a)|(b))\\g{-1}", "X X ab"],
  ["inside reference", "aa bb ab", "(?|(a)\\1|(b)\\1)", "X X ab"],
  ["forward reference", "aa bb", "\\1(?|(a)|(b))", "aa bb"],
  ["uneven condition", "a bc aac bcc", "(?|(a)|(b)(c))(?(2)c|a)", "a bc Xc X"],
  ["outside number", "aaz bbz ccz", "(?|(a)|(b)(b))(?<end>z)\\3?", "aX X ccz"],
  ["scoped flags", "Aa bB", "(?i:(?|(a)|(b))\\1)", "X X"],
  ["lookahead", "aa bb ab", "(?=(?|(a)|(b)))\\1\\1", "X X ab"],
  ["lookbehind", "aax bbx abx", "(?<=(?|(a)|(b)))\\1x", "aX bX abx"],
  ["atomic", "ab ac bc", "(?>(?|(a)|(ab)))c", "ab X bc"],
  ["repeated", "ababb bba aab", "(?|(a)|(b))+\\1", "X Xa Xb"],
  ["empty branch", "a b", "(?|()|(a))\\1", "XaX XbX"],
  ["empty group", "ab", "(?|)", "XaXbX"],
  ["ordinary nested", "aa bb cc dd", "(?|((a)|(b))|((c)|(d)))\\1", "X X X X"],
  ["flag propagation", "a B b A", "(?|(?i)(a)|(b))", "X X X X"]
])("matches native branch reset %s", (_label, source, pattern, expected) => {
  expect(calculate(expression([source!, pattern!, "X"]))).toEqual({ kind: "string", value: expected });
});
it("preserves raw byte results through branch reset groups", () => {
  expect(calculate(expression(["é", "(?|(\\xC3)|(a))(?(1)|.)", "X"])))
    .toEqual({ kind: "byte-string", value: "58a9" });
});
it.each(["(?|(a)|(b))\\2", "(?|(a)|(b))\\g{-2}"])
  ("rejects nonexistent capture references after branch reset %s", pattern => {
    expect(() => calculate(expression(["ab", pattern, "X"]))).toThrow("PERL_SED");
  });

// Perl 5.34.1 regcomp.c: explicit numeric references never fall back to octal.
it.each([
  ["absolute", "aa aax ab", "(a)\\g1", "X Xx ab"],
  ["relative", "aa aax ab", "(a)\\g-1", "X Xx ab"],
  ["following literal", "aa aax ab", "(a)\\g1x", "aa X ab"],
  ["multiple captures", "abba abbb", "(a)(b)\\g-1\\g-2", "X abbb"],
  ["two digit index", "abcdefghijj abcdefghija", "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\\g10", "X abcdefghija"],
  ["forward", "aa", "\\g1(a)", "aa"],
  ["branch reset", "aa bb", "(?|(a)|(b))\\g-1", "X X"],
  ["uneven branch reset", "aba bcb", "(?|(a)|(b)(c))\\g-2", "aba X"],
  ["scoped flags", "aA Aa", "(?i:(a)\\g1)", "X X"],
  ["outer capture", "abab aaaa", "((a)b)\\g1", "X aaaa"],
  ["numeric spaces", "aa aax ab", "(a)\\g{ 1 }", "X Xx ab"],
  ["relative tabs", "aa aax ab", "(a)\\g{\t-1\t}", "X Xx ab"],
  ["numeric suffix", "aa aax ab", "(a)\\g{1junk}", "X Xx ab"],
  ["numeric spaced suffix", "aa aax ab", "(a)\\g{1 a}", "X Xx ab"],
  ["relative suffix", "aa aax ab", "(a)\\g{-1x}", "X Xx ab"],
  ["numeric trailing newline", "aa aax ab", "(a)\\g{1\n}", "X Xx ab"],
  ["named spaces", "aa", "(?<pick>a)\\g{ pick }", "X"],
  ["named tabs", "aa", "(?<pick>a)\\k{\tpick\t}", "X"]
])("matches native explicit backreference spelling: %s", (_label, source, pattern, expected) => {
  expect(calculate(expression([source!, pattern!, "X"]))).toEqual({ kind: "string", value: expected });
});
it("preserves raw bytes through unbraced backreferences", () => {
  expect(calculate(expression(["é", "(\\xC3)\\g1?", "X"]))).toEqual({ kind: "byte-string", value: "58a9" });
});
it.each(["(a)\\g001", "(a)\\g{-01}", "(a)\\g{01}", "(a)\\g0", "(a)\\g-0",
  "(a)\\g", "(a)\\g-", "(a)\\g+1", "(a)\\g{+1}", "(a)\\g{1", "(a)\\g{ 1",
  "(a)\\g{2147483648}", "(a)\\g2147483648", "(?<pick>a)\\k< pick >"])
  ("refuses native-invalid explicit backreference %s", pattern => {
    expect(() => calculate(expression(["aa", pattern, "X"]))).toThrow("PERL_SED");
  });

// Perl 5.34.1 regcomp.c alphabetic assertions share the symbolic assertion nodes.
it.each([
  ["pla", "ab ac cb", "(a)", "\\1b", "X ac cb", "ab c ac", "a", "ab|c", "X X aX"],
  ["positive_lookahead", "ab ac cb", "(a)", "\\1b", "X ac cb", "ab c ac", "a", "ab|c", "X X aX"],
  ["nla", "ab ac cb", "a", ".", "aXXaXXXX", "ab c ac", "a", "c|ab", "X X aX"],
  ["negative_lookahead", "ab ac cb", "a", ".", "aXXaXXXX", "ab c ac", "a", "c|ab", "X X aX"],
  ["plb", "aax bbx abx", "(a)", "\\1x", "aX bbx abx", "ab cb", "a", "b|c", "aX Xb"],
  ["positive_lookbehind", "aax bbx abx", "(a)", "\\1x", "aX bbx abx", "ab cb", "a", "b|c", "aX Xb"],
  ["nlb", "ab cb aa", "a", ".", "XbXXXXXa", "ab cb", "a", "c|b", "aX Xb"],
  ["negative_lookbehind", "ab cb aa", "a", ".", "XbXXXXXa", "ab cb", "a", "c|b", "aX Xb"]
])("matches native alphabetic assertion %s", (alias, source, inner, suffix, expected, conditionSource, condition, branches, conditionExpected) => {
  expect(calculate(expression([source!, `(*${alias}:${inner})${suffix}`, "X"])))
    .toEqual({ kind: "string", value: expected });
  expect(calculate(expression([conditionSource!, `(?(*${alias}:${condition})${branches})`, "X"])))
    .toEqual({ kind: "string", value: conditionExpected });
});
it.each([
  ["atomic", "abc ac", "(*atomic:a|ab)c", "abc X"],
  ["atomic captures", "aab abb", "(*atomic:(a|ab))\\1b", "X abb"],
  ["nested assertions", "ab ac cb", "(*pla:(*nla:c)(a))\\1b", "X ac cb"],
  ["capture numbering", "aabb ab", "(a)(*pla:(b))(b)\\2", "aX ab"],
  ["scoped flags", "AB ab aB", "(?i:(*pla:a)ab)", "X X X"],
  ["repeated assertions", "aba aba", "(*pla:(a))a\\1?", "XbX XbX"],
  ["empty positive", "ab", "(*pla:)", "XaXbX"],
  ["empty negative", "ab", "(*nla:)", "ab"]
])("preserves native alphabetic assertion behavior: %s", (_label, source, pattern, expected) => {
  expect(calculate(expression([source!, pattern!, "X"]))).toEqual({ kind: "string", value: expected });
});
it("preserves raw bytes through alphabetic assertions", () => {
  expect(calculate(expression(["é", "(*pla:\\xC3).", "X"]))).toEqual({ kind: "byte-string", value: "58a9" });
});
it.each(["(*pla)", "(*PLA:a)", "(*unknown:a)", "(*pla:a", "(?(*atomic:a)b|c)", "(?(*pla:a)b|c|d)"])
  ("refuses native-invalid alphabetic assertion %s", pattern => {
    expect(() => calculate(expression(["ab", pattern, "X"]))).toThrow("PERL_SED");
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

// Independent Perl byte-mode substitution results, including escaped endpoints.
it.each([
  ["0AaBC_[]", "[0-A]", "XXXBC_[]"],
  ["0AaBC_[]", "[\\x30-\\x41]", "XXXBC_[]"],
  ["Zz_aA", "[Z-_]", "XXXaA"],
  ["Zz_aA", "[\\x5a-\\x5f]", "XXXaA"],
  ["Zz_aA", "[Z-a]", "XXXXX"],
  ["Zz_aA", "[^Z-a]", "Zz_aA"],
  ["aAbBzZ_", "[A-Z]", "XXXXXX_"],
  ["aAbBzZ_", "[a-z]", "XXXXXX_"],
])("folds class members without expanding endpoints %j %j", (input, range, output) => {
  expect(calculate(expression([input, "(?i)" + range, "X"]))).toEqual({ kind: "string", value: output });
});

it('admits patterns deeper than sixty-four groups unless a host depth is configured', () => {
  const formula = expression(['a', '('.repeat(65) + 'a' + ')'.repeat(65), 'X']);
  expect(calculate(formula)).toEqual({ kind: 'string', value: 'X' });
  expect(() => calculate(formula, { ...context, limits: { ...context.limits, patternDepth: 64 } })).toThrow('pattern depth limit');
});
