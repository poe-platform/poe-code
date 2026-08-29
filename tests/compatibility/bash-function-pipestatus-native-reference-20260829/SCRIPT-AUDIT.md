# Exact 26-program audit

Status: Proposed; observations UNRUN. Programs are unchanged bytes from
`4afc868da16edccb825adfdc51b2a702efc4e079`, matrix blob
`dd037378e4c58bdf514e38aa6240f6c9d2e62f54`. No expected outputs are adopted.

| ID | Literal command/control surface | Effect / disposition |
|---|---|---|
| F02 | function f(), printf, literal f | No file access; proposed |
| F03 | function-name newline, printf, literal f | No file access; proposed |
| F04 | function with if/true/printf body, literal f | No file access; proposed |
| F05 | function f / printf / fixed `> out` | ONLY owned case work/out; proposed with explicit file rule |
| F06 | quoted literal `function` command, argument f | WITHHELD: exact failed lookup needs new permission |
| F07 | printf then incomplete function keyword | Parse observation only; no assumed pre-effect golden |
| F08 | function named if, quoted literal invocation | Function lookup, not variable command; proposed |
| F09 | definition of bad-name, colon body | No invocation / files; proposed wider-name observation |
| F10 | malformed function simple-command body | Parse observation only; no assumed output golden |
| P02 | printf with quoted initial PIPESTATUS expansion | No extra native instrumentation allowed |
| P03 | false / printf / printf | Expansion-before-update observation |
| P04 | false / true / false pipeline then printf | At most three source-derived stage starts reserved |
| P05 | set -o pipefail; false / true; printf | Two stage reservations; fresh process state |
| P06 | ! false / true; printf | Two stage reservations |
| P07 | ! [[ x = y ]]; printf | Builtin conditional only |
| P08 | ! ((0)); printf | Literal finite arithmetic only |
| P09 | false && true / true || false / printf | Lazy branches only |
| P10 | brace group false / true; printf | Two stage reservations |
| P11 | f body false / true / printf / return 7; f; printf | Two stages; no recursion |
| P12 | false; subshell printf; printf | One subshell reservation |
| P13 | pipeline then fixed command substitution printf / false; printf | Three cumulative reservations (two stages + one substitution), not all simultaneous |
| P14 | false; literal assignment; printf | No command-valued expansion |
| P15 | literal __surface_missing_command__; printf | WITHHELD: exact failed lookup needs new permission |
| P16 | readonly PIPESTATUS; false; printf | Fresh per-case state only |
| P17 | unset PIPESTATUS; printf | Fresh per-case state only |
| P18 | f with local PIPESTATUS / false / printf; pipeline; f; printf | Two stages; no recursion |

All source text is ASCII, no NUL, no eval/source/profile invocation, external
successful executable, slash-bearing command, dynamically expanded command name,
heredoc/here-string, dynamic fd, loop, network operation, private path, or startup
file access. The finite function invocations have literal names. F06/P15 are not
quietly counted as builtin-only. The fixed cwd-relative F05 pathname cannot be
provided by the guest environment.

## Input and effects

Initial fixture inventory: **zero files, zero input bytes in every case**.
Host provisions fresh 0700 case work/home/tmp/empty-path directories. Case work
starts empty; no parent existing workdir is reused. For F05 only, the after-image
may add exactly `work/out`, regular, no symlink, one link, owner match, at most
65536 bytes. Record exact mode/size/hash/bytes without a predicted golden. All
other directory membership/modes remain unchanged; unexpected effects stop.
No rename/symlink/host-path output permission. Do not precreate `out` or add shell
commands to inspect it. Zero pre-input fixtures is not zero permitted after-effects.

## Raw framing

The supplied scripts print their own LF/text output, not EREOBS1 NUL records.
Adding a native printf/assignment capture wrapper would mutate PIPESTATUS and
invalidate input identity. Preserve raw stdout/stderr/status and after-effects.
The **host-side** proposed envelope is NUL-delimited ASCII fields:
`FNPIPEOBS1`, id, numeric exit status, stdout-byte-length, stdout-base64,
stderr-byte-length, stderr-base64, effects-JSON-base64, each followed by NUL.
This is an encoding of raw bytes, not a native variable-cardinality observation.
Empty arrays versus a printf-generated empty field are not inferred. No trimming,
newline normalization or path rewrite. Diagnostics retain exact argv0
`surface-function-pipestatus`; different historical argv0 is not normalized.
