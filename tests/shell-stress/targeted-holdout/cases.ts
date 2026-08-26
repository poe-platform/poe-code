import type { StressCase } from "../model.js";

export interface HoldoutCase extends StressCase {
  readonly group: "descriptor" | "read" | "shortcut" | "ansi" | "pathname" | "fatal" | "prevalidation";
  readonly locale?: "C" | "en_US.UTF-8";
}

const readTail = '; status=$?; printf "<%s>|<%s>:%s:" "$first" "$second" "$status"; cat';
const descriptorEnd = '; printf tail >&3; status=$?; printf "end:%s" "$status"; : >after; } 3>out';

export const holdoutCases: readonly HoldoutCase[] = [
  { group: "descriptor", name: "literal-builtin-move-source-stays-closed", script: '{ printf head >&3; printf body 4>&3- >&4' + descriptorEnd },
  { group: "descriptor", name: "literal-function-move-source-stays-closed", script: 'send() { printf body >&4; }; { printf head >&3; send 4>&3-' + descriptorEnd },
  { group: "descriptor", name: "literal-group-move-source-stays-closed", script: '{ printf head >&3; { printf body >&4; } 4>&3-' + descriptorEnd },
  { group: "descriptor", name: "literal-subshell-move-isolated", script: '{ printf head >&3; ( printf body >&4 ) 4>&3-' + descriptorEnd },
  { group: "descriptor", name: "external-cat-versus-plugin-move-scope", script: '{ printf head >&3; cat input 4>&3- >&4' + descriptorEnd, initialFiles: { input: "body" } },
  { group: "descriptor", name: "pipeline-move-isolated-from-parent", script: '{ printf head >&3; printf body | cat 4>&3- >&4' + descriptorEnd },
  { group: "descriptor", name: "expanded-output-move-is-not-literal", script: 'target=3-; { printf wrong; } 3>out 4>&$target; printf "status:%s" "$?"; : >after' },
  { group: "descriptor", name: "quoted-expanded-input-move-is-not-literal", script: 'target=3-; { cat <&4; } 3<input 4<&"$target"; printf "status:%s" "$?"', initialFiles: { input: "untouched" } },
  { group: "descriptor", name: "moved-input-alias-shares-read-offset", script: '{ IFS= read -rn2 first <&4; IFS= read -rd: second <&5; printf "<%s>|<%s>:" "$first" "$second"; cat <&4; } 3<input 5<&3 4<&3-', initialFiles: { input: "abCD:tail" } },
  { group: "descriptor", name: "move-chain-closes-original-before-later-redirect", script: '{ printf wrong; } 3>out 4>&3- 5>&3; printf "status:%s" "$?"; : >after' },
  { group: "read", name: "count-wins-before-custom-delimiter", script: 'IFS= read -n3 -d : first' + readTail, stdin: "abcd:rest\n" },
  { group: "read", name: "escaped-delimiter-counts-as-data", script: 'IFS= read -n3 -d : first' + readTail, stdin: "a\\:b:tail" },
  { group: "read", name: "continuation-does-not-use-count", script: 'IFS= read -n3 -d : first' + readTail, stdin: "a\\\nbc:tail" },
  { group: "read", name: "raw-delimiter-after-backslash", script: 'IFS= read -rn8 -d : first' + readTail, stdin: "a\\:b:tail" },
  { group: "read", name: "nul-delimiter-beats-count", script: 'IFS= read -rn8 -d "" first' + readTail, stdin: "a\nb\0tail" },
  { group: "read", name: "non-delimiter-nul-is-not-counted-modern", script: 'IFS= read -rn3 first' + readTail, stdin: "a\0b\0cZ" },
  { group: "read", name: "eof-retains-escaped-partial-value", script: 'IFS= read -n5 -d : first' + readTail, stdin: "ab\\c" },
  { group: "read", name: "zero-count-resets-variables-leaves-input", script: 'first=old; second=old; IFS= read -n0 -d : first second' + readTail, stdin: "untouched:tail" },
  { group: "read", name: "zero-count-still-rejects-closed-input", script: 'first=old; read -n0 first 0<&-; status=$?; printf "<%s>:%s:" "$first" "$status"; cat', stdin: "untouched" },
  { group: "read", name: "utf8-two-characters-keeps-byte-tail", script: 'IFS= read -rn2 first' + readTail, stdin: "é😀Z", locale: "en_US.UTF-8" },
  { group: "read", name: "c-locale-two-bytes-not-two-unicode-characters", script: 'IFS= read -rn2 first' + readTail, stdin: "é😀Z", locale: "C" },
  { group: "read", name: "read-count-shared-with-next-delimited-read", script: 'IFS=: read -rn4 first second; printf "<%s>|<%s>:%s:" "$first" "$second" "$?"; IFS= read -rd: first; printf "<%s>:%s:" "$first" "$?"; cat', stdin: "a:b:c:tail" },
  { group: "shortcut", name: "shortcut-stdin-after-partial-read", script: 'IFS= read -rn2 first; value=$(<input); printf "<%s>|<%s>:%s:" "$first" "$value" "$?"; cat', stdin: "ABremaining", initialFiles: { input: "file\n\n" } },
  { group: "shortcut", name: "shortcut-missing-file-assignment-status", script: 'value=$(<missing); status=$?; printf "<%s>:%s:" "$value" "$status"; cat; : >after', stdin: "kept" },
  { group: "shortcut", name: "shortcut-directory-read-failure-status", script: 'value=$(<folder); status=$?; printf "<%s>:%s:" "$value" "$status"; : >after', initialFiles: { "folder/child": "kept" } },
  { group: "shortcut", name: "shortcut-nul-removal-warning-is-observable", script: 'value=$(<input); printf "<%s>:%s" "$value" "$?"', initialFiles: { input: "a\0b\n" } },
  { group: "shortcut", name: "shortcut-only-last-input-redirect-is-read", script: 'value=$(<first <second); printf "<%s>:%s:" "$value" "$?"; cat', stdin: "outer", initialFiles: { first: "one\n", second: "two\n\n" } },
  { group: "shortcut", name: "shortcut-input-descriptor-failure-visible", script: 'value=$(<input 0<&9); status=$?; printf "<%s>:%s:" "$value" "$status"; cat', stdin: "outer", initialFiles: { input: "file\n" } },
  { group: "ansi", name: "ansi-concatenation-preserves-quoted-wildcards", script: "printf '<%s>' pre$' a\\t*'post $'' end", initialFiles: { "pre a\tMATCHpost": "" } },
  { group: "ansi", name: "ansi-nul-truncates-word-segment-not-suffix", script: "printf '<%s>' pre$'a\\0hidden'suf $'\\x00hidden'" },
  { group: "ansi", name: "ansi-unicode-four-eight-hex-escapes", script: "printf '<%s>' $'\\u00e9\\U0001f600Z'", locale: "en_US.UTF-8" },
  { group: "ansi", name: "ansi-c-locale-unicode-escape-bytes", script: "printf '<%s>' $'\\u00e9\\U0001f600Z'", locale: "C" },
  { group: "ansi", name: "ansi-unknown-and-incomplete-escapes-retained", script: "printf '<%s>' $'\\q\\x\\u\\U\\8\\9'" },
  { group: "ansi", name: "ansi-escaped-dollar-backtick-single-quote", script: "printf '<%s>' $'\\$\\`\\\'\\\\'" },
  { group: "ansi", name: "ansi-octal-hex-width-and-control", script: "printf '<%s>' $'\\1012\\x414\\cA\\e'" },
  { group: "ansi", name: "ansi-syntax-inside-double-quotes-remains-literal", script: "printf '<%s>' \"pre$'a\\n*'post\"" },
  { group: "pathname", name: "negated-digit-class-separate-path-segments", script: "printf '<%s>' [![:digit:]]/[[:digit:]].txt", initialFiles: { "a/7.txt": "", "b/8.txt": "", "3/9.txt": "", "a/x.txt": "" } },
  { group: "pathname", name: "class-slash-boundary-and-hidden-path", script: "printf '<%s>' */[[:alpha:]][[:digit:]]", initialFiles: { "a/A7": "", "b/z9": "", "b/77": "", ".hidden/Q1": "", "b/.A7": "" } },
  { group: "pathname", name: "quoted-brackets-do-not-form-active-class", script: "printf '<%s>' '[[:digit:]]'.txt \"[\"[:digit:]].txt [[:digit:]].txt", initialFiles: { "[[:digit:]].txt": "", "4.txt": "" } },
  { group: "pathname", name: "multiple-negated-posix-classes", script: "printf '<%s>' [![:alpha:][:digit:]].txt", initialFiles: { "_.txt": "", "-.txt": "", "7.txt": "", "A.txt": "", ".txt": "" } },
  { group: "fatal", name: "required-parameter-function-aborts-recovery-and-tail", script: 'call() { : "${missing:?holdout-stop}"; printf wrong; }; : >before; call || printf recovered; : >after' },
  { group: "fatal", name: "required-parameter-subshell-modern-status-one", script: ': >before; ( : "${missing:?holdout-stop}"; : >wrong ); status=$?; printf "status:%s" "$status"; : >after' },
  { group: "fatal", name: "required-parameter-substitution-only-inner-fatal", script: ': >before; value=$(printf inner; : "${missing:?holdout-stop}"; : >wrong); status=$?; printf "<%s>:%s" "$value" "$status"; : >after' },
  { group: "fatal", name: "arithmetic-expansion-group-aborts-whole-shell", script: ': >before; { printf "%s" "$((7/0))"; : >wrong; } || printf recovered; : >after' },
  { group: "fatal", name: "arithmetic-command-failure-is-recoverable", script: ': >before; ((7/0)) || printf "recovered:%s" "$?"; : >after' },
  { group: "fatal", name: "arithmetic-substitution-isolated-fatal-status", script: ': >before; value=$(printf inner; printf "%s" "$((7/0))"; : >wrong); status=$?; printf "<%s>:%s" "$value" "$status"; : >after' },
  { group: "prevalidation", name: "invalid-substitution-prevents-earlier-and-later-effects", script: 'printf before >before; value=$(printf x |); printf "<%s>:%s" "$value" "$?"; : >after' },
  { group: "prevalidation", name: "invalid-unused-function-substitution-is-upfront", script: ': >before; never() { value=$(printf x |); }; : >after' },
  { group: "prevalidation", name: "invalid-substitution-in-unselected-branch-is-upfront", script: ': >before; if false; then value=$(printf x |); fi; : >after' },
];
