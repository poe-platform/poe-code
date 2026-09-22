# Fold intended behavior receipt

Task `behavior-fold`, 2026-09-19. Implementation remains in the private,
dependency-free TypeScript ESM workspace `safe-bash-command-fold`. Safe Bash
only re-exports its API. Existing publication/build changes and the moved package
pattern were preserved; the archived package-pattern document was read.

The retained candidate is a single last-blank byte offset in the fixed 8192-byte
line buffer. It is updated only after an original decoded unit is retained and
discarded at LF, file end, ordinary wrapping and finite-buffer flushing. Release
blank membership excludes NBSP and figure space. Emission includes the separator.
Remainder scanning still applies stateful column adjustment before replaying the
overflow glyph; caching blank position does not cache or replace that adjustment.
Too-wide units on an empty line consume their original bytes once.

`FoldLimits.decodedBytes` optionally limits original encoded bytes decoded once,
including invalid bytes and LF; omission preserves the input-byte bound. Limits
are snapshotted. `accounting()` returns a frozen invocation snapshot of input,
decoded and output bytes, live/peak retained line/prefix bytes and admitted work.
Counters survive disposal; live retained bytes become zero. Peak counting includes
the brief overlap of decoder prefix and retained copy. Fixed buffer admission
requires 8196 bytes; returned output is separately bounded by cumulative output
admission and belongs to callers. It is not a host heap/RSS measurement.

Work admission precedes output allocation/copy, line copies and remainder moves;
decoded byte processing, rescanned bytes, column adjustments and overflow replay
are charged. A column adjustment includes the bounded binary lookup in the pinned
width tables. Decoder examination is at most four bytes per attempt. No recursion,
per-glyph retained object list or candidate segment growth is used. Fixed initial
allocation and disposal wiping are bounded by the admitted buffer size. Calls
remain capped at 4096 input bytes, with cancellation checks between bounded units.
No external resource, signal listener or ambient capability is acquired.

## Reviewed acceptance increments

Original memory-only edge tests were run first: missing decoded-byte accounting
and uncharged copy work failed. Implementation followed, then existing exact-byte
controls were rerun. Additional complete-output controls strengthened long-run
checks without replacing existing assertions or changing runtime budgets.

| Behavior cell | Local status | Evidence |
| --- | --- | --- |
| Separator included, last separator preferred | Passed | Existing exact space/upstream fixtures |
| Release NBSP/figure-space exclusions | Passed | Existing independently transcribed upstream fixtures |
| Candidate reset at LF | Passed | `a b LF cdef`, width3, three chunk sizes |
| Candidate reset at file end | Passed | Ordered `a SPACE` then `bcde`, width3 |
| Candidate reset at finite flush, no extra LF | Passed for fixed 8192-byte profile | SPACE/CR/NUL boundary fixture, three chunk sizes |
| CR reset and exact BS adjustment | Passed | Original width3 controls and existing wide/tab/BS controls |
| TAB overflow replay in space mode | Passed | `a b TAB cd`, width4, three chunk sizes |
| Width smaller than encoded/display glyph | Passed | Byte-mode `界a`, width1; existing column-mode too-wide controls |
| Invalid input versus remainder rescan | Passed | Existing exact invalid-byte fixtures |
| LF/file prior-glyph-width survival | Passed | Existing released state controls and file-end tests |
| 12000 combining marks, columns | Passed | Complete unchanged bytes |
| 12000 combining marks, spaces | Passed | Complete unchanged bytes |
| 12000 combining marks, bytes | Passed | Complete source-derived bytes, 4001 LFs |
| 12000 combining marks, characters | Passed | Complete source-derived bytes, 1715 LFs |
| Decoded admission, including malformed prefix and LF | Passed | Independent byte budget3 boundary |
| Output copying work admission | Passed | 3000 NUL bytes then bounded end-file emission |
| Full supplied 90-state cohort | Open | Complete independent transcripts unavailable |
| General libc `en_US.UTF-8` qualification | Open | Portable profile is deliberately distinct |
| Native unsigned arithmetic wraparound | Open | Checked-JS rejection retained; no independent native underflow control |
| Long-buffer native-build equivalence | Open | IO_BUFSIZE/build profile still needs qualification |
| Native diagnostics and input-file failures | Open | Exact native diagnostics/transcripts unavailable |
| VFS command, invocation cleanup, CLI/SDK registration | Open, subsequent command/stream tasks | This task changes the pure engine only |
| Installed tarball for this increment | Open | Memory-staged public artifact tested; no tarball installation claimed |

The acceptance document's byte-mode long-run expected expression requires a
source-derived correction: at width7 each three combining marks occupy six bytes,
so the final `a` fits before `b` overflows. Exact output is
`repeat(repeat(U+0301,3)+LF,3999) + repeat(U+0301,3) + a + LF + bc + LF`,
not 4000 mark-only lines followed by `abc LF`. Both have 4001 LFs, explaining
why the supplied LF-count summary alone cannot resolve this fixture difference.
The existing planning document was preserved; the new complete-byte test pins
the source-derived expression. No native execution is claimed for this correction.

## Source and verification evidence

Explicitly downloaded released GNU coreutils9.10 and verified archive SHA256
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Read release fold.c, fold manual section, fold-spaces, fold-nbsp, fold-characters
and fold-zero-width tests. Read development snapshot
`b25722854370b8206d7f53f8934c36710cdd9974` fold.c and manual section; the release
uses blank/nonbreaking-space checks where development uses c32issep. These are
source readings, not host-oracle observations. No host utility or locale ran.

Maintained focused unit route: 26 tests passed, no skips. Command lint and source/
test typechecks passed. Selected maintained `@poe-platform/safe-bash` build closure
passed, including guarded build and postbuild. Public packaging was exercised
with memory-only output under `/out`; packaged fold resolved solely from staged
public files and passed exact runtime output plus strict NodeNext declarations
for the new accounting API. No private command workspace was installed. Initial
memory-adapter attempts failed on missing file methods and incorrect `/out`
ancestor routing; the corrected adapter passed. The actual host `/out` is
unavailable/read-only, so no physical temporary evidence was stored elsewhere.
Memory evidence was purged. No CLI visual behavior changed; no screenshot claim.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No publication was performed. Full repository checks were not run for this
focused pure-engine increment. Open cells above remain open.

## Behavior diff review

Reviewed the existing behavior implementation against the released 9.10 source,
manual and fold-spaces/fold-nbsp/fold-characters/fold-zero-width tests, then the
development snapshot source and manual. Re-downloaded the release archive in
memory and verified the recorded SHA256. No native utility or ambient locale
was executed. The cached last separator is equivalent to the release's search
within this profile: it identifies a decoded-unit boundary, includes the blank,
and leaves no later blank in the moved remainder. Column recomputation remains
stateful, charges rescan/replay work and preserves prior glyph width. Fixed-buffer
flushing discards the search window without adding LF.

Reviewed failure retirement, cancellation, ownership, byte budgets, work admission
and absence of recursion or host access. No validated engine defect, unnecessary
abstraction, proxy-only function or duplicated algorithm warranted a code change.
Existing contributors' implementation and tests were preserved. This review
does not provide a new red/green implementation cycle; the original failing-test
evidence remains recorded above.

Re-ran the maintained command unit route: 26 passed, no skips. Command lint and
production/test typechecks passed. The selected maintained Safe Bash build closure
passed, including guarded build and postbuild. Public packaging was staged using
memfs under virtual `/out/fold-review`, then the fold export was loaded through a
resolver that allowed only staged public artifact files. Exact separator,
wide/TAB/BS and too-wide byte-mode outputs and decoded accounting passed. The
public fold declaration entry had no bare private fold import. An initial staging
attempt failed because the adapter omitted `open`; the completed adapter passed.
Memory staging was purged in finally. This is staged-artifact runtime evidence,
not a fresh installed-tarball or strict public declaration-consumer check.

The acceptance cells marked open above remain open and prevent claiming complete
native/CLI compatibility. In particular, the existing stream-inspection command
still uses its previous implementation; wiring it to this engine belongs to
`command-fold` and is not certified by these pure-engine checks. No screenshot
was required because this review changes no visual CLI behavior. No local commit,
push, release or publication was performed.

## Current behavior-fold verification

Re-inspected the working-tree engine without changing implementation or existing
tests. Verified the released archive SHA256 in memory, read release fold.c,
the fold manual and fold.pl/fold-spaces/fold-nbsp/fold-characters/fold-zero-width
tests, and compared snapshot fold.c and its manual. No validated behavior defect
was found; no new failing-test/fix cycle is claimed. Existing red/green evidence
above remains historical evidence, not a reproduction in this run.

The maintained fold workspace unit route passed all 26 tests, with zero skips;
workspace lint and both typechecks passed. The selected maintained Safe Bash
build closure passed including postbuild. An independent memory-only browser
bundle contained only fold workspace source inputs and passed exact separator/LF
output, cleanup and unavailable-locale rejection in a fresh Node VM with no
injected host capabilities. This is conditional realm evidence, not execution
in an actual browser or workerd. No native utility or implicit locale was used.

Two verification setup failures were resolved: the root unit runner rejects
`--workspace`, so the maintained workspace `test:unit` script was run directly;
the initial archive read omitted upstream shell tests' `.sh` suffixes, corrected
on the subsequent complete source read. Neither is an implementation failure.
Full repository gates and fresh installed-tarball verification were not run in
this review. CLI/VFS/checkpoint/replay, native diagnostics and complete native
runtime matrices remain open as listed above. No visible CLI change or screenshot
is claimed. Research and bundle evidence were held in memory. Local commits,
remote delivery and releases: none.
