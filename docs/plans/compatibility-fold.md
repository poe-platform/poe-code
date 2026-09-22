# Fold independent-control qualification

Execute manual QA against the working-tree candidate. Native processes are
research controls only; unit tests use memory and never invoke them. Preserve
unrelated edits and publish nothing.

1. Verify the GNU coreutils 9.10 archive SHA256
   `16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
   Read `src/fold.c`, its manual section and all five `tests/fold` files.
   Compare development revision `b25722854370b8206d7f53f8934c36710cdd9974`.
2. Build only the released research Fold executable with explicit local tools.
   Execute controls with explicit C and en_US.UTF-8 locales; compare raw bytes,
   status and stderr with the candidate, feeding candidate input in three-byte
   chunks. Record tool versions and distinguish libc from the portable profile.
3. Use these ordered inputs: empty; `abcdef`; `abcdef LF`; `a TAB b TAB c LF`;
   `界界界 LF`; `a U+0301 b U+0301 c U+0301`; `ab CR cdef`; `ab BS cde`;
   `界 TAB BS ABCDE LF`; `界 LF TAB BS ABCDE LF`; `ab U+00A0 cd`;
   `ab U+2007 cd`; `ab U+2002 cd`; two spaces then `abc`;
   U+0301 repeated 12000 then `abc LF`; 20000 NULs;
   8191 ASCII `a`, `뉐`, 100 ASCII `a`, LF;
   hex `c3 7c ed ba ad 00 ff 85 61`.
   Cross widths 1, 5, 7, 80 with default, -b, -c, -s, -sb, -sc, -bc, -cb.
   Minimize any differences before changing implementation; add failing fast
   regressions first. Profile differences are not automatic implementation bugs.
4. Run maintained command lint/unit and selected Safe Bash build closure. Map
   upstream fullwidth and input-buffer-edge variants and verify bounded retained
   state on a finite 1 MiB streaming zero-width fixture. Do not infer speed or
   process memory from semantic accounting checks.
5. Run actual opt-in Shell CLI wrapping with memory VFS and SDK parity; capture
   an ad hoc screenshot through the maintained screenshot tool and inspect it.
   Run the maintained fold boundary tests for negative host authority controls.
6. Record candidate HEAD and source-content hashes, passes/failures/skips,
   unavailable runtime/replay cells and omitted gates separately. Historical
   installed-artifact evidence is not new evidence for this candidate. Purge only
   task-owned temporary output after durable capture.

Temporary evidence uses ignored `out/compatibility-fold` because the documented
host root does not allow `/out`. Performance measurements remain a separate task.

## Executed receipt, 2026-09-19

Candidate HEAD: `35d01c57f8078d8afa916dc59929395d857e9c55`, with existing
uncommitted Fold/package integration. HEAD alone does not identify this candidate.
The SHA256 of production Fold sources is
`b705e1b0dee7b3119227415f3cc3af23a25d53e527260fc6f4a6dc1209b96f54`:
sort non-test `.ts` filenames under the command's `src`, hash each filename plus
NUL followed by its complete file bytes. No production implementation changed
in this qualification. Added memory-only regression/qualification tests.

Runtime/tools: Node v22.22.2, npm 10.9.7, TypeScript 5.9.3; Darwin arm64,
Apple clang 17.0.0 (`clang-1700.0.13.5`), target arm64-apple-darwin24.6.0.
Released executable identifies itself as `fold (GNU coreutils) 9.10`.
Explicit oracle environments used PATH=/usr/bin:/bin and LC_ALL=C or
en_US.UTF-8; the candidate used C or UTF-8/Unicode-17.0.0 respectively.
The latter is a portable profile, not an assertion of arbitrary libc parity.

Reverified the archive digest in step 1, read released source/manual and
fold.pl, fold-characters, fold-nbsp, fold-spaces and fold-zero-width. Read the
development Fold source and corresponding manual section at the supplied revision. Release uses
`c32isblank && !c32isnbspace`; snapshot uses `c32issep`. Release also explicitly
initializes two static booleans in main. These observations are source-derived.
Released Fold source SHA256:
`579245402394706b2e75909991bb6379d17c814611c7d24367c5c94df938d25d`;
snapshot Fold source SHA256:
`0172cb5af864c0f75eacce93778c1b72510869a2d333c9c4b9a7d1458c77e3a9`.
The archived package-pattern plan is now at
`docs/plans/archive/safe-bash-command-package-pattern.md`; its original path was
already deleted in the supplied working tree and was not restored.

### Native semantic controls

Executed all 1,152 cells specified in step 3: 1,120 exact byte/status/stderr
matches and 32 differences. No missing cells, timeouts or process errors in this
matrix. Every native cell returned status 0 with empty stderr. Native controls
read stdin and wrote captured stdout; they made no VFS changes. Candidate engine
input arrived in three-byte chunks, including splits inside encodings. Output
comparison used complete bytes, including original LF and absent final LF.

Fixture-set SHA256 is
`7574f064758659868c3cebc177061cd7472ebaf677bb41d82596e75ffea4b5a1`:
hash the ordered fixtures from step 3, each prefixed by its decimal encoded byte
length and LF. The raw JSON comparison receipt SHA256 was
`aa799c245a8469669c43b3b912818613c190169f41dadf67a539d4eca70679e2`.
Those temporary full-byte rows were inspected before purging; the fixture and
matrix definitions above remain reproducible. No generated/random cases or
seed-dependent findings were used.

All 32 differences are the final malformed fixture under en_US.UTF-8, across
eight flag profiles and four widths. Minimized independently to one FF byte:

| Input hex | Native locale/mode | Native stdout hex | Candidate stdout hex | Status/effect |
| --- | --- | --- | --- | --- |
| `ff` | UTF8, columns/bytes/characters, width80 | empty | `ff` | native 0, empty stderr; candidate preserves byte |
| `ff61` | UTF8, same modes | empty | `ff61` | native also loses suffix, status0 |
| `ff61` | C, same modes | `ff61` | `ff61` | exact match, status0 |
| `8561` | UTF8, same modes, width80 | `8561` | `8561` | negative control: malformed input alone is not sufficient |
| `61e7958c0808` | UTF8 columns, width80 | `61e7958c080a08` | no returned output; `ARITHMETIC` | native0; candidate closes invocation |
| `61e7958c0808` | UTF8 bytes/characters, width80 | `61e7958c0808` | `61e7958c0808` | mode negative controls |

Released `lib/mbbuf.h` assigns `buffer[offset++]` (plain char) to g.ch after a
decoder error; MBBUF_EOF is UINT32_MAX. The observed UTF8 FF behavior is consistent
with signed-char promotion to that sentinel on this build. C takes a different
decoder path. This is a concrete platform-dependent native observation, not a
claim that every GNU build loses FF. Candidate policy deliberately retains
invalid bytes as required. A fast regression now pins FF plus suffix retention
in both profiles and all three modes; no data-loss emulation was introduced.

The backspace fixture demonstrates native unsigned subtraction underflow,
independently of the earlier supplied controls. Checked JS rejects the second
backspace instead of emulating unsigned wrap and overflow replay. Existing fast
underflow regression verifies rejection and retirement. These two differences
prevent a blanket GNU compatibility claim; neither is concealed as a pass.

Additional controls:

- 18 two-file cases: first `界`, `界 LF` or `a U+0301`; second
  `TAB BS ABCDE LF`; default/-c/-b, width7, both locales. All exact matches,
  status0 and empty stderr. For UTF8 columns, first `界` then second file emits
  hex `e7958c0908410a424344450a` across the two files. Native fixtures existed
  only in the research output directory; candidate used engine file boundaries.
- Missing file followed by the second file at width3/C: native status1,
  stdout `090a084142430a44450a`, diagnostic
  `fold: out/compatibility-fold/absent: No such file or directory LF`.
  Existing memory-VFS tests verify candidate continuation and combined status1;
  exact native pathname/diagnostic rendering is not claimed.
- 17 option/admission cases: -w with 0, +5, 05, leading-space5, 1.5, -5, 5x,
  18446744073709551616; -12; -w5; --width=5; --wid=5; -bc; -cb; -12b;
  -1w5; and ordered -1 -2. All admission decisions match. Rejections return
  native1 and empty stdout; candidate throws WIDTH. Successful width5 cases
  on `abcdef` emit `61626364650a66`; width2 emits `61620a63640a6566`.
  Legacy12 and default80 emit `616263646566`. Error wording is not parity proof.
- Four mapped fold-zero-width controls: 16384 NULs in C and 16384 U+200B in
  UTF8, default80/-c. Native status0, empty stderr; exact outputs preserve input
  in columns, and emit 204 complete groups of 80 scalars plus LF then 64 scalars
  without final LF in characters. Output lengths are 16384/16588 and
  49152/49356 bytes respectively. Fast memory regressions pin these outputs.

The first direct `make src/fold` attempts failed on missing generated gnulib
headers. The normal `make -j4` route generated headers and completed, exit0;
the original released source was not patched. Compiler duplicate-library
warnings do not represent semantic passes or failures. No fallback host Fold
or installed BSD utility was used. Native executables remain manual controls.

### Candidate gates and limits

Maintained command unit route: 68 passes, zero failures/skips. Maintained command
lint, production/test typechecks and selected workspace build closure
`npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: pass.
Three actual Shell Fold boundary tests: pass, including pipes/redirection/VFS
scripts, SDK parity, symlink truncation and absent host-path/network authority.
Existing tests cover cross-realm bytes, forged/detached/proxied inputs, byte argv,
unavailable profiles, budgets, output errors, cancellation and awaited cleanup.
New upstream mappings cover both 50-fullwidth-character modes, complete
8191-byte input-buffer-edge output at chunk sizes1/3/4096, NUL and U+200B.
The `/dev/full` infinite native stress variant is not executed; mocked downstream
failure and bounded finite streaming are mapped candidate controls.

The new 1 MiB combining stream verifies every delivered byte, no invented LF,
owned output despite caller mutation, zero retained bytes at file end, and
peak retained accounting <=8196. This proves deterministic engine accounting,
not process RSS, throughput, latency, or the total memory of caller-retained
output. No performance measurements were made.

Staged version0.0.0-compatibility-fold; packed only SafeFS/SafeJS/SafeBash,
installed offline with scripts disabled outside the checkout. Maintained Fold,
smoke and registration runtime fixtures and strict NodeNext Fold declaration
consumer pass. No private Fold/contracts workspace installed; AST inspection
of 1,256 shipped JS/declaration files found no bare private specifiers.
The command remains private, with empty runtime dependencies; Safe Bash composes
and exports it, and ships implementation/declarations through its private bundle
recipe. This makes no zero-dependency claim about unrelated Safe Bash engines.

| Public verification artifact | SHA256 |
| --- | --- |
| SafeFS | `727cf05fe60deddeb6380e112f94c99e6c6056a84f79768f3922942c2932312c` |
| SafeJS | `4c5b6d341d4e444025c96f2db8eacfd2d5cdb33bd701515bb9abf777cae7b27e` |
| SafeBash | `cad579d92357f509e40fbf6ae21dee2cbf6d9fa998830e7f38cda595aff86033` |

Actual opt-in Shell CLI/SDK output equality passed. Captured and inspected an
ad hoc screenshot with `npm run screenshot -- --output <evidence>/fold.png
--no-header node <evidence>/visible.mjs`. ASCII separator-inclusive wrapping
and combining text rendered visibly; CJK glyphs were missing-font boxes, so
CJK visual width remains unverified. Exact CJK output bytes pass separately.
The generic maintained screenshot route is used because Fold is a Shell opt-in
command, not a top-level poe-code command. No screenshot tests were added.

Node ESM and explicit C/portable UTF8 profiles are qualified within the limits
above. Actual browser/workerd/Bun, other libc locales, Fold-specific
checkpoint/replay and full realm isolation remain unverified. Node VM byte
admission and the installed smoke fixture's general realm checks are narrower
evidence. No replay behavior or host boundary implementation changed here.
Upstream native Perl pipe/file variants are mapped to existing actual Shell
tests and 18 native file controls rather than counted as upstream harness runs.

Full repository npm test/lint/build were not rerun for this focused tests/docs
change. The historical broad-gate failure in safe-bash-fold-command-qa.md
remains unresolved and is not replaced by these passing focused checks.
Qualification remains limited by the explicit differences and missing cells.
Unrelated working-tree edits were preserved. No local commits, remote-main
delivery, releases or private-package publication. Task-owned temporary research,
tarballs, screenshot and external installed consumer were purged after capture.
