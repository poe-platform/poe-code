import type { StressCase } from "../model.js";
import { differentialCases } from "../cases.js";

export const oldGapNames = [
  "descriptor-move-closes-original-after-copy",
  "read-n-consumes-exactly-two-characters",
  "read-d-consumes-through-delimiter-only",
  "command-substitution-file-shortcut-reads-and-trims",
  "ansi-c-quoted-word-decodes-escape-before-argument-passing",
  "nested-substitution-syntax-error-does-not-prevent-earlier-effects",
  "fatal-parameter-expansion-prevents-following-file-effect",
  "fatal-arithmetic-expansion-prevents-following-file-effect",
  "fatal-expansion-in-substitution-stops-substitution-only",
  "glob-posix-bracket-digit-class",
] as const;

export const oldGaps = oldGapNames.map(name => {
  const fixture = differentialCases.find(candidate => candidate.name === name);
  if (!fixture) throw new Error(`Missing unchanged old expectation: ${name}`);
  return fixture;
});

export const additionalCases: StressCase[] = [
  { name: "move-output-really-closes-source", script: "{ printf moved >&4; printf lost >&3; printf 'status=%s' \"$?\"; } 3>saved 4>&3-" },
  { name: "move-input-really-closes-source", script: "{ IFS= read -r value <&4; printf '<%s>' \"$value\"; IFS= read -r missing <&3; printf 'status=%s' \"$?\"; } 3<input 4<&3-", initialFiles: { input: "first\nsecond\n" } },
  { name: "read-n-stops-at-newline-before-count", script: 'IFS= read -r -n 4 value; status=$?; printf "<%s>:%s:" "$value" "$status"; cat', stdin: "a\nrest\n" },
  { name: "read-d-empty-selects-nul", script: 'IFS= read -r -d "" value; status=$?; printf "<%s>:%s:" "$value" "$status"; cat', stdin: "a\nb\0tail\n" },
  { name: "read-d-missing-delimiter-retains-data-with-failure", script: 'IFS= read -r -d : value; status=$?; printf "<%s>:%s:" "$value" "$status"; cat', stdin: "tail" },
  { name: "file-shortcut-does-not-consume-inherited-stdin", script: 'printf "<%s>" "$(<input)"; cat', stdin: "host\n", initialFiles: { input: "file\n\n" } },
  { name: "ansi-c-word-is-quoted-not-split-or-globbed", script: "printf '<%s>' prefix$'a b\\t*'suffix", initialFiles: { match: "" } },
  { name: "pathname-classes-c-locale-alpha-negation", script: "printf '<%s>' [[:alpha:]].txt [![:digit:]].txt", initialFiles: { "7.txt": "", "A.txt": "", "b.txt": "" } },
  { name: "prevalidation-prior-output-and-file", script: 'printf before; printf marker >marker; printf "%s" "$(true |)"; printf after' },
  { name: "fatal-parameter-preserves-only-earlier-effects", script: 'printf before >before; : "${missing:?stop}"; printf after >after' },
  { name: "unmatched-case-bracket-literal-control", script: 'case "[" in [) printf literal;; *) printf wrong;; esac' },
];
