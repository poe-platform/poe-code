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
