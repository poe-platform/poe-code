import type { StressCase } from "./model.js";

export const differentialCases: StressCase[] = [
  { name: "descriptor-save-and-restore-routes-stderr-through-pipe", script: "{ printf out; printf err >&2; } 3>&1 1>out 2>&3 3>&- | cat" },
  { name: "descriptor-move-closes-original-after-copy", script: "{ printf moved >&4; } 3>saved 4>&3-" },
  { name: "closing-stdout-then-reopening-is-left-to-right", script: "printf restored 1>&- >restored; cat restored" },
  { name: "closing-stderr-does-not-close-duplicated-stdout", script: "printf retained 2>saved 1>&2 2>&-; cat saved" },
  { name: "group-redirection-is-restored-after-return", script: "f() { printf inner; return 7; }; f >inner; printf 'status=%s;' \"$?\"; printf outer; cat inner" },
  { name: "pipe-established-before-stderr-copy-and-output-redirect", script: "{ printf out; printf err >&2; } 2>&1 >out | cat; cat out" },
  { name: "nested-truncate-does-not-reset-outer-file-offset", script: "{ printf abcdef; printf XY >same; printf Z; } >same; cat same" },
  { name: "independent-output-descriptors-have-separate-offsets", script: "{ printf abcdef; printf XY >&2; printf '!'; printf Z >&2; } >same 2>same; cat same" },
  { name: "duplicated-output-descriptors-share-offset", script: "{ printf abcdef; printf XY >&2; printf '!'; printf Z >&2; } >same 2>&1; cat same" },
  { name: "append-descriptor-observes-intervening-truncation", script: "{ printf abc; printf X >same; printf Y; } >>same; cat same", initialFiles: { same: "old" } },
  { name: "redirect-expansion-side-effect-precedes-truncate", script: 'printf payload >"$(printf marker >marker; printf target)"; cat marker target' },
  { name: "read-and-substitution-consume-one-inherited-offset", script: 'IFS= read -r first; value=$(cat); printf "<%s><%s>" "$first" "$value"; cat', stdin: "first\nsecond\nthird\n" },
  { name: "read-in-subshell-consumes-input-but-not-parent-variable", script: 'value=outer; (IFS= read -r value; printf "[%s]" "$value"); IFS= read -r next; printf "[%s][%s]" "$value" "$next"; cat', stdin: "one\ntwo\ntail" },
  { name: "multiple-input-redirections-only-last-is-consumed", script: 'IFS= read -r line <one <two; printf "[%s]" "$line"; cat', initialFiles: { one: "ONE\n", two: "TWO\n" }, stdin: "HOST\n" },
  { name: "read-n-consumes-exactly-two-characters", script: 'IFS= read -r -n 2 value; printf "[%s]" "$value"; cat', stdin: "abcdef\n" },
  { name: "read-d-consumes-through-delimiter-only", script: 'IFS= read -r -d : value; printf "[%s]" "$value"; cat', stdin: "ab:cd:ef\n" },
  { name: "read-backslash-newline-joins-before-splitting", script: 'read first second; printf "[%s][%s]" "$first" "$second"; cat', stdin: "one\\\n two three\nrest\n" },
  { name: "read-last-variable-preserves-inner-separators", script: 'IFS=: read -r first rest; printf "[%s][%s]" "$first" "$rest"', stdin: "one::two:three:\n" },
  { name: "redirected-pipeline-input-leaves-inherited-input-intact", script: 'printf unused | { IFS= read -r value; printf "[%s]" "$value"; } <input; cat', initialFiles: { input: "file\n" }, stdin: "host\n" },
  { name: "pipefail-picks-rightmost-nonzero-not-first", script: "set -o pipefail; (exit 7) | (exit 3) | cat; printf '%s' \"$?\"" },
  { name: "pipeline-negation-with-pipefail-controls-conditional", script: "set -o pipefail; ! (exit 9) | cat && printf yes; printf '%s' \"$?\"" },
  { name: "function-in-middle-of-pipeline-preserves-bytes", script: "copy() { cat; }; printf 'a\\000b\\n' | copy | cat >binary; cat binary" },
  { name: "early-pipeline-reader-closes-bounded-producer", script: "for value in 1 2 3 4 5 6 7 8; do printf '%s\\n' \"$value\"; done | head -n 1; printf done", limits: { pipeHighWaterMark: 1 } },
  { name: "quoted-positional-at-concatenates-only-edge-fields", script: 'f() { printf "<%s>" "pre$@post"; }; f "one two" "" three; f' },
  { name: "quoted-star-uses-first-ifs-character", script: 'f() { IFS=:; printf "<%s>" "$*"; IFS=; printf "<%s>" "$*"; }; f one "two words" "" three' },
  { name: "ifs-nonwhitespace-delimiters-retain-empty-fields", script: 'IFS=:; value=":a::b:"; printf "<%s>" $value' },
  { name: "quoted-empty-prefix-preserves-otherwise-empty-field", script: 'value=; printf "<%s>" ""$value $value "$value"' },
  { name: "default-operator-does-not-evaluate-unused-substitution", script: 'value=kept; printf "<%s>" "${value:-$(printf wrong >unexpected)}"; printf "<%s>" "${missing:+$(printf wrong >unexpected)}"' },
  { name: "assignment-default-side-effect-persists-outside-expansion", script: 'printf "<%s><%s>" "${value:=two words}" "$value"; printf "%s" "$value" >result' },
  { name: "prefix-assignment-value-expansion-sees-prior-assignment", script: 'first=old; first=new second=$first; printf "<%s><%s>" "$first" "$second"' },
  { name: "command-substitution-file-shortcut-reads-and-trims", script: 'printf "<%s>" "$(<input)"', initialFiles: { input: "one\ntwo\n\n" } },
  { name: "substitution-retains-interior-newlines-and-isolates-variable", script: 'value=outer; result=$(value=inner; printf "a\\nb\\n\\n"); printf "<%s><%s>" "$result" "$value"' },
  { name: "last-assignment-substitution-status-wins", script: 'first=$(exit 7) second=$(exit 3); printf "%s" "$?"' },
  { name: "substitution-does-not-reparse-metacharacters", script: 'value=$(printf "x; printf wrong >unexpected"); printf "<%s>" "$value"' },
  { name: "ansi-c-quoted-word-decodes-escape-before-argument-passing", script: "printf '<%s>' $'one\\ntwo\\tthree'" },
  { name: "backquote-substitution-preserves-double-quoted-result", script: 'printf "<%s>" "`printf \'one two\\n\\n\'`"' },
  { name: "quoted-glob-fragment-remains-literal-inside-pattern", script: "printf '<%s>' 'a*'?.txt", initialFiles: { "a*1.txt": "yes", "abc1.txt": "no", "a*2.txt": "also" } },
  { name: "glob-question-mark-matches-one-character-including-brackets", script: "printf '<%s>' x?.txt", initialFiles: { "x[.txt": "", "x].txt": "", "xx.txt": "", "xzz.txt": "" } },
  { name: "glob-hidden-directory-requires-explicit-dot", script: "printf '<%s>' */*.txt .hidden/*.txt", initialFiles: { "normal/a.txt": "", ".hidden/b.txt": "", "normal/.secret.txt": "" } },
  { name: "redirect-glob-resolves-single-match-with-space", script: "printf replacement >*.txt; cat *.txt", initialFiles: { "one file.txt": "old" } },
  { name: "tilde-prefix-in-assignment-not-in-quoted-word", script: 'HOME=/home/fixture; value=~/child; printf "<%s><%s>" "$value" "~/child"' },
  { name: "heredoc-tab-stripping-keeps-other-whitespace", script: "cat <<-END\n\talpha\n \tbeta\n\tEND\n" },
  { name: "multiple-heredocs-last-input-wins", script: "cat <<FIRST <<'SECOND'\nunused\nFIRST\n$value $(printf literal)\nSECOND\n" },
  { name: "here-string-expands-without-splitting-or-globbing", script: "value='a * b'; cat <<<$value", initialFiles: { match: "" } },
  { name: "arithmetic-logical-branch-does-not-mutate-unused-side", script: 'value=0; printf "%s,%s,%s" "$((0 && (value=7)))" "$((1 || (value=9)))" "$value"' },
  { name: "compound-loop-return-restores-outer-function-positionals", script: 'inner() { printf "<%s>" "$1"; return 4; }; outer() { for value in a b; do inner "$value"; done; printf "<%s>" "$1"; }; outer kept' },
  { name: "nested-substitution-syntax-error-does-not-prevent-earlier-effects", script: "printf touched >marker; printf '%s' \"$(true |)\"" },
  { name: "early-reader-must-not-cancel-upstream-non-pipe-effects", script: "{ :; : >after; } | :" },
  { name: "early-reader-must-not-cancel-redirected-producer-output", script: "printf abc >out | true" },
  { name: "early-reader-must-not-replace-upstream-failure-with-sigpipe", script: "set -o pipefail; { true; false; } | true" },
  { name: "fatal-parameter-expansion-prevents-following-file-effect", script: ': "${missing:?stop}"; : >after' },
  { name: "fatal-arithmetic-expansion-prevents-following-file-effect", script: ': "$((1/0))"; : >after' },
  { name: "fatal-expansion-in-substitution-stops-substitution-only", script: 'value=$(printf "%s" "${missing:?stop}"; printf wrong); printf "<%s>:%s\\n" "$value" "$?"' },
  { name: "group-inherits-descriptor-three-for-inner-redirection", script: "{ printf x >&3; } 3>out" },
  { name: "group-inherits-input-descriptor-and-shared-read-offset", script: '{ IFS= read -r first <&3; printf "<%s>\\n" "$first"; cat <&3; } 3<input', initialFiles: { input: "a\nb\n" } },
  { name: "redirect-target-substitution-inherits-earlier-stderr-redirect", script: 'printf hi 2>err >"$(printf diagnostic >&2; printf out)"' },
  { name: "read-escaped-ifs-character-is-not-a-field-separator", script: 'read first second; printf "<%s>|<%s>\\n" "$first" "$second"', stdin: "a\\ b c\n" },
  { name: "read-mixed-ifs-whitespace-does-not-create-spurious-fields", script: 'IFS=" :" read first second third; printf "<%s>|<%s>|<%s>\\n" "$first" "$second" "$third"', stdin: " a : b : c \n" },
  { name: "read-discards-single-trailing-nonwhitespace-ifs-delimiter", script: 'IFS=: read first second; printf "<%s>|<%s>\\n" "$first" "$second"', stdin: "a:b:\n" },
  { name: "quoted-pattern-removal-star-is-literal", script: 'value="abc*def"; printf "<%s>\\n" "${value%"*"*}"' },
  { name: "glob-posix-bracket-digit-class", script: "printf '<%s>\\n' [[:digit:]].txt", initialFiles: { "1.txt": "", "a.txt": "" } },
  { name: "command-substitution-removes-nul-bytes", script: 'value=$(printf "a\\0b"); printf "<%s>\\n" "$value"' },
  { name: "export-prefix-assignment-persists-in-shell", script: 'value=old; value=new export value; printf "<%s>\\n" "$value"' },
  { name: "local-without-assignment-starts-unset", script: 'value=outer; func() { local value; printf "<%s>\\n" "$value"; }; func' },
  { name: "glob-matches-newline-bytes-and-the-exact-filename", script: "printf '<%s>\\n' * a?b a[ab]", initialFiles: { "a\nb": "", "aa\n": "", plain: "" } },
  { name: "parameter-patterns-match-newlines-with-exact-boundaries", script: 'value="a\n"; printf "<%s>\\n" "${value##*}" "${value%%*}" "${value##?}" "${value%?}"' },
];

let seed = 0x5eed1234;
for (let index = 0; index < 6; index++) {
  const initialFiles: Record<string, string> = {};
  for (let file = 0; file < 10; file++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const letter = String.fromCharCode(97 + seed % 4);
    const name = `${letter}${file % 3 ? "" : " "}${file}.txt`;
    initialFiles[name] = `${seed}\n`;
  }
  initialFiles[".hidden.txt"] = "hidden";
  differentialCases.push({
    name: `seed-5eed1234-glob-pipeline-${index}`,
    script: "for value in [ab]*.txt; do printf '[%s]\\n' \"$value\"; cat \"$value\"; done | cat >result; cat result",
    initialFiles,
    limits: { pipeHighWaterMark: 1 + index },
  });
}

export const syntaxCases: StressCase[] = [
  { name: "unterminated-quote-after-write", script: 'printf touched >marker; printf "unterminated' },
  { name: "missing-pipeline-command-after-write", script: "printf touched >marker; true |" },
  { name: "missing-conditional-operand-after-write", script: "printf touched >marker; true &&" },
  { name: "missing-group-terminator-after-write", script: "{ printf touched >marker;" },
  { name: "missing-if-fi-after-write", script: "printf touched >marker; if true; then printf wrong" },
];
