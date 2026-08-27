export interface DiagnosticCase {
  readonly id: string;
  readonly cohort: "original" | "extension" | "control";
  readonly args: readonly string[];
  readonly stderr: string;
}

const original: readonly [string, readonly string[], string][] = [
  ["ambiguous-index-keyword", ["index", "index", "a"], "syntax error: missing argument after 'a'"],
  ["missing-operands", [], "missing operand\nTry 'expr --help' for more information."],
  ["missing-rhs", ["1", "+"], "syntax error: missing argument after '+'"],
  ["missing-close", ["(", "1", "+", "2"], "syntax error: expecting ')' after '2'"],
  ["trailing-token", ["1", "2"], "syntax error: unexpected argument '2'"],
  ["skip-still-requires-rhs", ["kept", "|", "1", "+"], "syntax error: missing argument after '+'"],
  ["skip-still-requires-close", ["0", "&", "(", "1"], "syntax error: expecting ')' after '1'"],
  ["skip-still-requires-keyword-args", ["kept", "|", "substr", "abc", "1"], "syntax error: missing argument after '1'"],
];

const controls: readonly [string, readonly string[], string][] = [
  ["empty-after-end-options", ["--"], "missing operand\nTry 'expr --help' for more information."],
  ["forced-token-missing", ["+"], "syntax error: missing argument after '+'"],
  ["length-missing", ["length"], "syntax error: missing argument after 'length'"],
  ["index-missing", ["index", "abc"], "syntax error: missing argument after 'abc'"],
  ["match-missing", ["match", "abc"], "syntax error: missing argument after 'abc'"],
  ["substr-missing", ["substr", "abc", "2"], "syntax error: missing argument after '2'"],
  ["open-only", ["("], "syntax error: missing argument after '('"],
  ["unexpected-close", [")"], "syntax error: unexpected ')'"],
  ["empty-group", ["(", ")"], "syntax error: unexpected ')'"],
  ["wrong-close", ["(", "1", "2"], "syntax error: expecting ')' instead of '2'"],
  ["nested-missing-close", ["(", "(", "1", ")"], "syntax error: expecting ')' after ')'"],
  ["trailing-close", ["(", "1", ")", ")"], "syntax error: unexpected argument ')'"],
  ["rhs-close", ["1", "+", ")"], "syntax error: unexpected ')'"],
  ["help-is-not-an-option-with-operands", ["--help", "x"], "syntax error: unexpected argument 'x'"],
  ["version-is-not-an-option-with-operands", ["--version", "x"], "syntax error: unexpected argument 'x'"],
  ["skip-or-forced-token", ["kept", "|", "+"], "syntax error: missing argument after '+'"],
  ["skip-and-prefix", ["0", "&", "length"], "syntax error: missing argument after 'length'"],
  ["skip-or-wrong-close", ["kept", "|", "(", "1", "x"], "syntax error: expecting ')' instead of 'x'"],
  ["skip-and-trailing", ["0", "&", "1", "x"], "syntax error: unexpected argument 'x'"],
  ["skip-invalid-regex-then-trailing", ["kept", "|", "match", "abc", "[", "extra"], "syntax error: unexpected argument 'extra'"],
  ["quoted-apostrophe", ["1", "a'b"], "syntax error: unexpected argument 'a\\'b'"],
  ["quoted-backslash", ["1", "a\\b"], "syntax error: unexpected argument 'a\\\\b'"],
  ["quoted-newline", ["1", "a\nb"], "syntax error: unexpected argument 'a\\nb'"],
  ["quoted-tab", ["1", "\t"], "syntax error: unexpected argument '\\t'"],
  ["quoted-control-bytes", ["1", "\x01\x07\b\v\f\r\x1b\x7f"], "syntax error: unexpected argument '\\001\\a\\b\\v\\f\\r\\033\\177'"],
  ["quoted-utf8-bytes", ["1", "é😀"], "syntax error: unexpected argument '\\303\\251\\360\\237\\230\\200'"],
  ["quoted-double-quote", ["1", "\""], "syntax error: unexpected argument '\"'"],
  ["quoted-empty", ["1", ""], "syntax error: unexpected argument ''"],
  ["missing-after-empty", ["index", ""], "syntax error: missing argument after ''"],
  ["missing-after-newline", ["index", "+", "a\nb"], "syntax error: missing argument after 'a\\nb'"],
  ["close-after-apostrophe", ["(", "+", "a'b"], "syntax error: expecting ')' after 'a\\'b'"],
  ["close-instead-of-backslash", ["(", "1", "a\\b"], "syntax error: expecting ')' instead of 'a\\\\b'"],
];

export const diagnosticCases: readonly DiagnosticCase[] = [
  ...original.map(([id, args, body]) => ({ id, args, cohort: "original" as const, stderr: `expr: ${body}\n` })),
  { id: "class-parenthesis-not-capture", cohort: "extension", args: ["(", ":", "[(]"], stderr: "expr: syntax error: expecting ')' instead of '[(]'\n" },
  ...controls.map(([id, args, body]) => ({ id, args, cohort: "control" as const, stderr: `expr: ${body}\n` })),
  ...["|", "&", "<", "<=", "=", "==", "!=", ">=", ">", "-", "*", "/", "%", ":"].map(operator => ({
    id: `missing-operator-rhs-${operator}`, cohort: "control" as const, args: ["1", operator],
    stderr: `expr: syntax error: missing argument after '${operator}'\n`,
  })),
];

export const validControls: readonly [string, readonly string[], string, number][] = [
  ["forced-index", ["index", "+", "index", "x"], "5\n", 0],
  ["forced-close", ["+", ")"], ")\n", 0],
  ["help-after-end-options", ["--", "--help"], "--help\n", 0],
  ["version-after-end-options", ["--", "--version"], "--version\n", 0],
  ["skip-division", ["kept", "|", "1", "/", "0"], "kept\n", 0],
  ["skip-noninteger", ["0", "&", "x", "+", "y"], "0\n", 1],
  ["skip-regex", ["kept", "|", "match", "abc", "["], "kept\n", 0],
  ["skip-regex-and", ["0", "&", "abc", ":", "["], "0\n", 1],
  ["nested-closed", ["(", "(", "1", ")", ")"], "1\n", 0],
  ["quoted-correction1", ["+", "(", ":", "[(]"], "1\n", 0],
];
