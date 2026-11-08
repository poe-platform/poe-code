import type { ClosureCase } from "./invocation-closure-cases.js";

const readCase = (name: string, options: string, stdin: string, locale = "C"): ClosureCase => ({
  name, locale, stdin,
  source: `value=old; second=old; read ${options} value second; result=$?; printf '<%s>|<%s>|<%s>:%s\\n' "$value" "$second" "$REPLY" "$result"; IFS= read -r -d '' tail; printf '[%s]' "$tail"`,
});

export const readCases: readonly ClosureCase[] = [
  readCase("exact newline", "-N4", "a\nbcZ"),
  readCase("n delimiter contrast", "-n4", "a\nbcZ"),
  readCase("zero count", "-N0", "untouched"),
  readCase("negative zero", "-N-0", "untouched"),
  readCase("positive sign", "-N+2", "abcd"),
  readCase("leading zero", "-N02", "abcd"),
  readCase("whitespace number", "-N ' 2 '", "abcd"),
  readCase("partial EOF", "-N5", "ab"),
  readCase("empty EOF", "-N1", ""),
  readCase("raw backslash", "-rN3", "a\\bZ"),
  readCase("escaped character", "-N2", "a\\ bZ"),
  readCase("continuation", "-N3", "a\\\nbcZ"),
  readCase("trailing backslash EOF", "-N4", "ab\\"),
  readCase("N ignores later delimiter", "-N3 -d :", "a:bZ"),
  readCase("N ignores earlier delimiter", "-d : -N3", "a:bZ"),
  readCase("N ignores NUL delimiter", "-N3 -d ''", "a\0bcZ"),
  readCase("N skips NUL", "-N2", "a\0bZ"),
  readCase("sticky N last count n", "-N4 -n3", "a bZ"),
  readCase("sticky N newline", "-N3 -n4", "a\nbcZ"),
  readCase("last count N", "-n1 -N3", "a\nbZ"),
  readCase("repeat N", "-N1 -N3", "abcZ"),
  readCase("UTF8 codepoints", "-rN2", "é😀Z", "en_US.UTF-8"),
  readCase("C byte boundary", "-rN2", "éZ", "C"),
  readCase("negative count", "-N-1", "untouched"),
  readCase("invalid decimal", "-Nnope", "untouched"),
  readCase("invalid hex", "-N0x2", "untouched"),
  { name: "N ignores IFS", stdin: " a:b Z", source: 'IFS=:; read -N5 first second; printf "<%s>|<%s>:%s\\n" "$first" "$second" "$?"; IFS= read -r tail; printf "[%s]" "$tail"' },
  { name: "N REPLY", stdin: " a bZ", source: 'read -N4; printf "<%s>:%s\\n" "$REPLY" "$?"; IFS= read -r tail; printf "[%s]" "$tail"' },
];
