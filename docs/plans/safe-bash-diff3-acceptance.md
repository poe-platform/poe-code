# diff3 behavior and acceptance matrix

This document records the completed research-diff3 specification and scoped behavior implementation evidence. See [behavior QA](safe-bash-diff3-behavior-qa.md) for the candidate receipt and remaining gates. GNU diffutils **3.12** is the accepted version target for this plan, including its observed `-X` behavior. No other release is implied. The [independent native corpus](safe-bash-diff3-native-controls.md) records exact bytes, argv, stderr and status. Broader integration, safety and compatibility remain separately tracked in [the command plan](safe-bash-diff3.md).

## Current-main inspection and ownership

Inspected local main at `35d01c57f8078d8afa916dc59929395d857e9c55` on 2026-09-19. `git ls-tree` and searches of current command sources/tests show no diff3 package, command, export or implementation tests. Existing research has concrete output examples but leaves binary/unterminated-script diagnostics as “stderr present” and summarizes option/stdin controls without retaining exact outputs. The new native corpus closes these documentation gaps. Absence of an implementation is not a runtime defect to repair during research.

The requested package-pattern path has an unrelated pending move. Read the tracked main version and the working copy at [archive/safe-bash-command-package-pattern.md](archive/safe-bash-command-package-pattern.md); preserve that move. Its requirements remain binding: actual logic in `packages/safe-bash-command-diff3`, manifest name `safe-bash-command-diff3`, `private: true`, TypeScript ESM, no external runtime dependencies. Do not create an empty scaffold for this research task. The implementation must use the existing private `safe-bash-contracts` leaf, without depending back on safe-bash. `@poe-platform/safe-bash/commands/diff3` will compose/export the command; opt-in registration must not change defaults.

Packed safe-bash JS and declarations must contain the private implementation with canonical contract identity and no unpublished bare imports. Qualification requires an installed consumer with command workspaces absent, runtime and declaration imports, actual shell byte argv, browser/workerd profiles where advertised, collision preflight and shared error/argument brands. Do not publish the private workspace. The maintained bundling/declaration policy, integration boundaries and dependency DAG are acceptance gates, not permission to modify shared infrastructure during research.

Read these current engines before selecting an algorithm:

| Source | Concrete current behavior | diff3 reuse decision |
| --- | --- | --- |
| `packages/safe-bash/src/commands/diff-patch/shared.ts` | `Budget.text` rejects NUL and invalid UTF-8; split operates on strings. Work, lines, input/output, matrix and cancellation limits exist. | Byte contracts cannot be reused unchanged for `-a` or invalid bytes. Reuse canonical stream/cancellation contracts; do not move unrelated code. |
| `packages/safe-bash/src/commands/diff-patch/diff.ts` | Private `edits` strips all equal prefix/suffix, allocates an LCS matrix, chooses deletion on ties. Recursive directory comparison is supported. | No demonstrated GNU horizon/discard/boundary-shift parity. Do not declare alignment compatible or silently use this as fallback. |
| `diff-format.ts`, `unified.ts`, `patch.ts`, `patch-formats.ts` in that directory | String-based report rendering and patch parsing/application; patch has separate VFS authorization/publication semantics. | Not a byte three-way engine or an ed executor. Do not confuse patch application with diff3 `-i`. |
| `packages/safe-bash/tests/commands/diff-patch/diff-patch.test.ts` and imported cases | Existing diff formats, patch authorizations, safety, cancellation and shell cases; no diff3 controls. | Preserve them. New fast memory-VFS tests must cover the new owner; independent native expectations remain outside engine test generation. |

Choose an original first-party byte alignment algorithm only after its admitted GNU profile passes the independent repeated-line cases. Equal edit distance is insufficient evidence. No default minimal/speed-large-files heuristic, UTF-8 normalization, greedy fallback, host executable, native/WASM fallback or runtime download is admitted.

## Native provenance and source specification

Official archive: https://ftp.gnu.org/gnu/diffutils/diffutils-3.12.tar.xz. SHA256 `7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd`. Research build uses matching GNU diff and diff3, C locale and no POSIXLY_CORRECT. Native tools are research-only, never product capabilities. Release GPL source provides behavioral evidence; implement original code, with license review before any source copying.

Source trace in that release:

| Source | Required evidence |
| --- | --- |
| `src/diff3.c:main` | Selector incompatibility bitset, flags, labels, exactly three operands, common-file mapping, duplicate-stdin check, operand0 reopen. |
| `process_diff`, `read_diff` | Pairwise normal-diff protocol, optional `-a` and `--strip-trailing-cr`, fixed `--horizon-lines=100`, internal `---no-directory`, `--`, operands. This is not a public executable-selection capability. |
| `make_3way_diff`, `create_diff3_block` | Pairwise hunk combination, coordinate mapping, equality classification, overlaps. |
| `output_diff3` | Report classification, file section ordering/ranges, TAB versus two-space content indentation, no-final-LF warnings. |
| `output_diff3_edscript`, `dotlines`, `undotlines` | Reverse block order, class filtering, markers, dot doubling/repair substitutions, final `w`/`q`. |
| `output_diff3_merge` | Retained operand0 bytes, class filtering, marker attachment to unterminated content, conflict return. |
| `src/io.c` and `src/analyze.c` | 100-line retained prefix/suffix horizon; `discard_confusing_lines`, `compareseq`, `shift_boundaries` affect ties. |

Report's default pairwise common is operand **3**, whereas ed/merge use operand **2**. Stdin can remap the internal pairwise common. This is comparison bookkeeping, not a universal ancestor rule. The public ed/merge operand meaning is ours/base/theirs; scripts describe changes to ours and merge emits content. Report remains a three-file comparison in its own native ordering.

## Option and classification matrix

Exactly three operands are required (even if empty files); missing/extra operands fail status 2. `--` ends option parsing and paths named hyphen require a VFS path such as `./-`. Select **at most one distinct** selector from `A/e/E/3/x/X`; repeating the same selector succeeds. Different selectors fail 2, including `-x -X`, despite their identical observed output. Without `-m`, any selector generates ed. `-m` alone implies `-A`. Grouped/order-permuted flags such as `-mE` and `-Em` are equivalent.

Classes below refer to argv order: DIFF_1ST means only ours differs; DIFF_2ND means only base differs (ours equals theirs); DIFF_3RD means only theirs differs; DIFF_ALL means all differ. “Preserve” means no ed command and retain ours in merge. “Replace” takes theirs with status 0. “Conflict” emits flagged content with status 1. Any flagged conflict anywhere makes the entire result status 1; errors take status 2.

| Selector | Flagging | DIFF_1ST | DIFF_2ND | DIFF_3RD | DIFF_ALL |
| --- | --- | --- | --- | --- | --- |
| `-A` (or bare `-m`) | Yes; show base | Preserve | Conflict: base versus theirs | Replace | Conflict: ours/base/theirs |
| `-E` | Yes; omit base | Preserve | Preserve | Replace | Conflict: ours/theirs |
| `-e` | No | Preserve | Preserve | Replace | Replace |
| `-3` | No | Preserve | Preserve | Replace | Preserve |
| `-x` | No | Preserve | Preserve | Preserve | Replace |
| `-X` | **No in 3.12** | Preserve | Preserve | Preserve | Replace |
| No selector, no merge | Report only | Report | Report | Report | Report |

Report differences return **0**, not 1. Unflagged replacements also return 0 even when all three inputs differ. Empty/identical input returns 0. Conflicts are a flagging result, not a generic “files differ” condition. GNU 3.12 `-X` conflicts emit the same unflagged ed script as `-x`; `-m -X` takes theirs, status 0; `-X -L` fails 2. Preserve that version-specific behavior rather than the conventional description in help text.

| Independent control | Acceptance |
| --- | --- |
| `-i` | Only appends `w\nq\n` to generated ed; no source mutation, ed process or patch application. Alone remains report and adds no script suffix. `-i -m` fails 2 before input. |
| `-T` | Report content indentation becomes one TAB; report structure unchanged. Ed/merge content unchanged. |
| `-L LABEL`, `--label=LABEL` | Up to three in operand order; missing labels default to that operand path. Allowed only actual flagging (`A/E`, or bare merge); report/e/3/x/X with labels fail 2. A fourth fails 2. Empty labels are valid. |
| `-a`, `--text` | Byte text comparison including NUL. Separate controls are required for binary equal/different inputs and invalid UTF-8. Never decode/re-encode source bytes. |
| `--strip-trailing-cr` | Changes comparison/changed-line representation, not wholesale output normalization. Merge can retain CRLF untouched prefix while changed lines lose CR. |
| `--diff-program` | Product explicitly rejects executable selection with status 2 before I/O. No host spawn and no disguised ignored option. Native controls use it only to select the matching research oracle. |

The exact native long inventory is `diff-program`, `easy-only` (3), `ed` (e), `help`, `initial-tab` (T), `label` (L), `merge` (m), `overlap-only` (x), `show-all` (A), `show-overlap` (E), `strip-trailing-cr`, `text` (a), `version` (v). There is no `-X` long synonym and no `-i` long synonym. The core profile targets this fixed inventory, with executable selection intentionally rejected. `--mer`, `--show-a`, `--overlap-o` are native unique prefixes; `--s` and `--show` are ambiguous and fail 2. Qualify abbreviation behavior against this fixed inventory before claiming arbitrary GNU abbreviation parity. `--help`/`--version` are informational status-0 routes, not three-way classifications; product capability/deviation text must be truthful.

## Byte output contracts and safety deviations

Default all-different merge markers are `<<<<<<< ours\n`, `||||||| base\n`, `=======\n`, `>>>>>>> theirs\n`. `-E` omits the base section. DIFF_2ND under A starts with `<<<<<<< base\nbase...`, then separator/theirs/end: it is not the normal ours/base/theirs form. Preserve exact native report header ordering (`====`, `====1/2/3`) and addresses rather than deriving a generic merge formatter.

Ed blocks are emitted in reverse order; a leading dot is doubled and an address/range substitution repairs it after the terminating dot line. Neither generated scripts nor `-i` execute on product input. Marker text can attach directly to unterminated source characters in merge. Report supplies LF plus `\\ No newline at end of file\n` on stdout. Ed supplies diagnostics on stderr, can still succeed, and can add LF in its line-oriented script; the corpus pins every warning byte/status. Do not convert a warning into status 2 or silently add LF to merge data.

Label safety contract: merge labels may be empty or contain LF and are emitted literally, subject to explicit label/output limits; they do not enter a host interpreter. Ed labels containing CR or LF are explicitly rejected before reading because interpolating them into executable ed text can inject commands. This is a declared safety deviation from GNU, which emits them literally. Empty/single-line ed labels remain supported. NUL in labels/paths is an argument error. The native LF-label fixture remains unchanged as the independent control; add separate product rejection tests rather than editing expected native output. Diagnostics must not let untrusted labels/paths inject terminal controls.

Product supports **one stdin operand in any position**, consumed once into bounded owned memory or VFS spooling and reused for pairwise comparisons/merge. Multiple stdin operands fail before reading any byte. GNU's report operand0+1 succeeds inconsistently, while its merge operand0 alone can fail reopening `-`; these are upstream defects, explicitly excluded. No host filename reopen, ambient temp file or network is allowed. Directory operands fail the VFS regular-file contract, without recursive comparison. Inaccessible/missing VFS inputs fail 2. Do not promise native host paths/localized OS error text as product diagnostics.

## Independent acceptance and implementation gates

At research completion product cells were unimplemented. The current behavior candidate implements the scoped cells below; incomplete qualification remains open. Keep independent native controls distinct from production unit tests: byte expectations come from the pinned corpus, never production rendering/alignment. Compatibility applies only to admitted cases, not all inputs merely because selected cases pass.

| Gate | Required original memory-VFS test or acceptance evidence | State |
| --- | --- | --- |
| Parser and modes | Every selector/class in ed and merge; report classes; duplicate/different selectors; grouped/permuted options; labels; `-i`; arity; `--`; fixed long inventory/ambiguity. | Implemented; fixed-inventory and class controls pass |
| Exact rendering | All corpus stdout/stderr/status bytes, markers, dot repairs, reverse scripts, missing LF and CR behavior. | Implemented for pinned successful controls; generic bounded error diagnostics and safe ed-label deviation documented |
| Byte comparison | NUL with/without `-a`, invalid UTF-8, empty/equal/unequal unterminated endings; BOM and arbitrary bytes remain owned/preserved. | Implemented; byte admission/preservation controls pass |
| Alignment | Original repeated-line swaps, insertion/deletion and nested blocks around 99/100/101 prefix/suffix lines with/without final LF; adjacency, same boundary and delete/edit. | Existing qualified engine controls pass; costly-search shortcut and universal tie parity remain open |
| Resource bounds | Limit input bytes, line/token metadata, comparison bytes/work, edit graph/matrix allocations, retained/spool bytes, labels, hunks and output before allocation/publication; safe integer arithmetic. Exhaustion is error 2, never greedy fallback or conflict. | Focused behavior/command quota controls pass; systematic safety audit open |
| Cancellation and cleanup | Pre-abort before read; cancellation during each read, spool, pairwise comparison, alignment and write; output/quota/sink failures. Abort follows canonical contract and releases every invocation reservation/iterator/spool, including late VFS resolution. | Focused cancellation/late acquisition/owned-write controls pass; systematic audit open |
| Stdin/VFS deviations | Three single-stdin positions equal SDK input results; all multiple-stdin combinations rejected before consumption; spool quota and cancellation; directory/error contracts; no mutation with `-i`. | Implemented; memory-VFS stdin, directory and no-mutation controls pass |
| Isolation/replay/realm | No process, ambient filesystem, network or downloads; own admitted byte copies and canonical runtime brands; cleanup and accounting on replay/realm boundaries. Mock external capabilities; never query an LLM. | No host fallback; owned-byte/brand controls pass; systematic replay/realm audit open |
| CLI/SDK/installed artifact | Same parsing/options/status/output through opt-in Shell and typed API; packed imports/declarations without private workspaces; maintained build and package checks. | Implemented; final Node ESM packed runtime/types pass; browser/workerd open |

Behavior changes used failing tests first, memory VFS and mocked capabilities. The behavior QA receipt distinguishes passing scoped controls from open global qualification; it records installed CLI screenshots and maintained build/test routes. No universal GNU parity or release claim follows from these cells.
