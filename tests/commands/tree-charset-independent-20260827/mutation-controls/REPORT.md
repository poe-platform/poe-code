# Installed-package mutation-control report

## Conclusion

The immutable candidate `f1a90436c45208ca248e058a039893233c608daa`
passed this bounded installed-package mutation review. Attempt 005 ran the same
11 checks in nine isolated scenarios: one unmodified baseline and eight
single-mutant installations. The baseline passed 11/11 checks; all 8/8 mutants
failed their mapped unchanged check. No candidate defect was found and no
product file was changed.

This is evidence for the selected tree charset controls only. It is not a full
gate, a complete mutation score, native parity, or evidence that the package is
better than another implementation.

## Authenticated inputs and package path

- Requested/resolved candidate commit:
  `f1a90436c45208ca248e058a039893233c608daa`; tree
  `c5cdfff66e64bb4d68926c4f93a7620eb89e7dcd`.
- Evidence commit `0d8623634995549d8e717d310c28db83a02a9532`
  resolved to tree `74fed21205f8aa166eb35c77c150ae0263fe6485`.
  All 14 files named by its `SEAL.json` matched their sealed SHA-256 values, and
  line 134 of its README was checked before selecting the controls.
- Freeze subtrees were resolved from exactly
  `a0445f4d5cff1c8451957ce684273e1225279588` and
  `55bd112804564605e397d3ee9948226d89efd457`, yielding trees
  `6ecb6953c6d3e2f448bab508ff7946123dc44d3c` and
  `db3f82f7c79badb5661ea16ca175576db39e270a`.
- The Git archive was 1,785,651,200 bytes with SHA-256
  `fe133818ee69dcbdac7e2330e97fefa1dd07037ba73c6135ccf106b770e7f325`.
  All 28,505 tracked blobs were authenticated before and after execution. The
  postflight also enumerated new entries and found all 1,078 beneath the allowed
  generated `dist/` or `node_modules/` trees; it found no other addition.
- The source package manifest SHA-256 was
  `2127bbfed020aeb7873462ae65224e6ee73069425c878aa2ceee9816b2191245`;
  the lockfile SHA-256 was
  `9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b`.
  The manifest named `virtual-bash` 0.0.0, packed only `dist`, and declared zero
  runtime dependencies.
- The packed artifact contained 762 paths and no `src/` path. Its SHA-256 was
  `2713175a12912952999c6e0e8d81cef2638692b573081bc281ba0e785d099bab`;
  its computed SHA-512 integrity matched npm's output. The installed inventory
  contained the same 762 files and stayed unchanged across mutant runs.
- Baseline root and `virtual-bash/commands/tree` requests resolved under the
  task-local consumer's `node_modules/virtual-bash/`, never the live checkout.
  The installed default registry contained exactly 70 commands and one `tree`.

Node, Git, npm, tar, the installed TypeScript/tsx entry points, and every harness
input have recorded paths and SHA-256 values in `attempt-005/results.json`.

## Unchanged checks and mutant kills

There were 11 checks per mutation scenario: three package/basic resolution
checks plus eight behavior controls. Thus 11 is the positive baseline assertion
count, nine is the mutation scenario/worker count, and eight is the mutant
count. Three stronger load-guard executions ran separately and do not inflate
those counts.

| Built-JavaScript mutant | Required unchanged check | Result |
| --- | --- | --- |
| environment always ASCII | environment selection | killed |
| explicit precedence ignored | explicit precedence | killed |
| ambient host environment used | ambient isolation | killed |
| inherited environment key used | inherited-key isolation | killed |
| filename emitted unescaped | filename escaping | killed |
| output charged as JS code units | UTF-8 byte cap | killed |
| environment work undercharged | work admission | killed |
| sink write not awaited | backpressure | killed |

Each mutation required one and only one exact replacement in a fresh copy of
the packed installation. Before/after module hashes and mutation text are in
the result file. Some mutants also failed additional checks; that does not
change the mapped 8/8 result.

The byte-cap control used an identical limit of 11: the output has 11 JavaScript
code units but 17 UTF-8 bytes. The baseline rejected it with `EFBIG`; the
code-unit mutant admitted it and was killed. The work control admitted a charge
of nine against a limit of eight. The baseline rejected before filesystem work;
the undercharge mutant made one instrumented filesystem call and was killed.

The baseline backpressure observation remained unsettled with one write open,
then settled only after both writes closed. The non-awaited mutant settled with
two writes open. After release, both completions were recorded as late relative
to command settlement, all outstanding writes reached zero, and only then did
the worker exit.

## Load and process controls

One unchanged guard resolved the requested entry, established its real package
root, hashed its manifest and entry, and imported only after all three values
matched. The final three executions retained requested, parent, and resolved
URLs plus expected/actual hashes:

- Positive request `virtual-bash` resolved inside the packed installation. Its
  manifest SHA-256
  `2127bbfed020aeb7873462ae65224e6ee73069425c878aa2ceee9816b2191245`
  and entry SHA-256
  `77b771a6066aa32f82b903f7a80c578132388d6d9cec9fbde15485915859df5d`
  matched, and 102 exports loaded.
- A separately npm-packed and installed `virtual-bash@9.9.9` request resolved
  inside that wrong consumer. Its manifest hash
  `434136a77c4fc8b5967c0e45630187c6b0dfec10159af56ff4163c6d48585e8f`
  and entry hash
  `8f52ab73fa91434f4aab73ce7c01d6010281b2e40ab6d047fceac741739f6db3`
  both differed; the guard rejected both dimensions and did not import it.
- A full same-byte copy of the genuine package was requested by file URL and
  resolved outside the expected installation. Both hashes still matched the
  positive values, so the sole rejection dimension was its real package root;
  it was not imported.

Attempt 005 recorded 51 child commands. Forty-nine exited zero; the two denied
load attempts exited with the guard's expected status 77. Every command timed
out zero times, overflowed zero times, and was absent after `close`. On this POSIX
host each child was launched as its own process group; timeout/overflow would
send `SIGKILL` to `-pid`. Post-close probes observed both all nine worker PIDs
and groups and all three load-control PIDs and groups absent. Workers and guards
used strict unhandled-rejection mode, all their stderr streams were empty, the
baseline had zero late sink completions, and the deliberate backpressure
mutant's two late completions were drained before process closure. Task scratch
was removed.

## Attempt history and limits

Attempt 001 already passed 11/11 and killed 8/8. Its evidence is preserved
unchanged. Its worker drained the deliberate backpressure mutant, but its error
serializer retained only the pre-release assertion difference, not the later
drain snapshot. That was a harness-evidence limitation, not a candidate defect.
Attempt 002 adds the raw post-release observation and process-group closure
checks. It does not change an assertion or candidate result. Two harmless final
blank lines were then removed from authored harness inputs. Attempt 003 preserves
a launcher-only `MODULE_NOT_FOUND` caused by invoking the correct relative path
from the wrong directory; no verifier or candidate code ran. Attempt 004 is the
successful normalized mutation run. Attempts 001, 002 and 004 used only the
weaker missing-package/nonexistent-file controls and are not counted as final
faulty-load evidence. Attempt 005 adds the actual wrong installed package and
same-byte outside copy; its tool manifest exactly matches the final inputs.

Likewise, an expected-failure assertion against already captured good output
does not show that a test detects faulty execution. These controls execute eight
altered installed modules against unchanged assertions. They supplement rather
than rewrite the retained earlier evidence.

The exact mutants cover eight selected fault shapes, not every equivalent
implementation error. The outside-source control proves only that this
nonexistent URL did not load; Node.js is not a sandbox, and an explicitly
imported existing file can execute. `kill(pid, 0)`/`kill(-pgid, 0)` absence is a
post-close observation and cannot rule out instantaneous identifier reuse. The
full committed archive is unusually large, so reproduction requires roughly
1.8 GB for the archive plus extracted/build/install scratch while it runs.
