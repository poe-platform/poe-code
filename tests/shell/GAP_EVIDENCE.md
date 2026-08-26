# Targeted shell corrections: evidence and limits

Reference capture on 2026-08-26 uses `/bin/bash` version
`3.2.57(1)-release (arm64-apple-darwin25)`, sanitized `LC_ALL=C`, isolated
temporary directories, literal argv, a two-second deadline and bounded output.
`bash-bugfix-helpers.ts` owns this capture. No modern Bash is installed.
The independent unchanged stress baseline is 95/105 passing, ten failing;
raw records are `/tmp/safe-bash-shell-gap-baseline.json`.

## Descriptor moves

`descriptor-moves.test.ts` captures output, status and file effects independently
for literal moves, duplicate aliases sharing input/output offsets, redirection
order, functions, pipelines and opposite-direction descriptor moves. Both move
operators copy the open descriptor before closing the original; they do not
change the descriptor's access mode. Cancellation and nondefault stdin origin
have separate contract tests.

Two additional observed Bash 3.2 differences are explicit and remain outside
the exact-native assertions. With
`{ say outer >&3; { say inner >&4; } 4>&3-; say restored >&3; } 3>out`, Bash
leaves descriptor 3 closed (status 1, `bash-probe: 3: Bad file descriptor`,
file `outer\ninner\n`). The virtual shell retains existing temporary-redirection
scope restoration (status 0, file also contains `restored\n`). With
`target=3-; { say moved >&4; } 3>out 4>&$target`, Bash returns 1,
`bash-probe: 3-: ambiguous redirect`, empty file; virtual-bash accepts the
expanded move and writes `moved\n`. No modern-native parity is claimed for
either form. These are recorded gaps, not excluded independent stress outcomes.

Primary reference: GNU Bash manual, Redirections / Moving File Descriptors,
https://www.gnu.org/software/bash/manual/html_node/Redirections.html .

## Read count and delimiter

`read-options.test.ts` compares count/delimiter consumption, escaping, raw mode,
IFS splitting, default REPLY, EOF and combined flags to the bounded reference.
UTF-8 character counting is additionally captured with `en_US.UTF-8`: installed
Bash 3.2 counts bytes, so `read -rn2` on `é😀z` assigns only `é`, leaves `😀z`,
status 0, empty stderr. The virtual text model counts Unicode characters
independently of host locale, assigns `é😀` and leaves `z`. This is an explicit
native difference, not an exact-Unicode-parity claim.
Delimiter matching uses the first encoded byte; an empty argument selects NUL.
Skipped NUL bytes follow the modern manual for these option forms, not a claim
of Bash 3.2 binary-text compatibility. Non-option reads retain prior behavior.
Unsupported flags, malformed counts and counts outside safe integer range are
rejected before input consumption with status 2. No timeout or descriptor-read
flag is silently accepted.

There is a version-specific zero-count difference: Bash 3.2
`IFS= read -n 0 value` with `abcdef\n` consumes the entire line, assigns
`abcdef`, status 0. The virtual shell follows the GNU manual's explicit
zero-character behavior: succeeds without consuming input, assigns empty text.
The zero-count test asserts that the underlying iterator is not pulled.
Primary reference: GNU Bash manual, Bash Builtins / read,
https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html .

## File-only command substitution

`file-shortcut.test.ts` captures a single input redirect with no command,
including a trailing semicolon and nonzero input descriptor. Multiple redirects
do not select the shortcut. Reads use the filesystem stream directly, without
requiring a registered `cat`, and retain the shared capture/output limits and
cancellation. Target expansion variables remain isolated; opened files do not
advance an enclosing descriptor's offset. NUL removal precedes newline trimming.
Substitution status is visible to subsequent expansions in the same command,
as observed with `false; printf '<%s>:%s' "$(<input)" "$?"` (status field 0).
Target errors terminate the substitution environment, not the outer shell.
