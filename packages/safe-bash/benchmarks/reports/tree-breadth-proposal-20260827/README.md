# Tree breadth: native diagnosis and proposed scope

Investigation only, August 27, 2026. **No implementation change authorized or
made.** The original breadth handoff, strict recipe, captures and scores remain
unchanged. This is not a comparator rerun, full gate or compatibility acceptance.

## Decision requested

Authorize native-style **environment-driven branch selection**, with explicit
`--charset` precedence, within `src/commands/tree` and new focused tests. Do not
decrement the report's populated-root count: it already matches the pinned native
2.2.1. The old strict recipe combines UTF-8 branches with a pre-2.1 count under a
C environment; changing the command to that unconditionally would regress the
verified native C/2.2.1 behavior, not improve it.

If ROOT specifically requires the old one-directory output as an additional
product capability, decide that explicitly as a **legacy descendant-count
compatibility mode**, separately from the modern native default. No new mode,
flag, factory option or historical expectation is introduced in this proposal.
Do not infer that implementing charset selection alone makes the old strict
recipe green: it does not.

## Frozen observations

Source: `8b89c0e76dfe581ce57418b391e74ce299686af7`. Relevant tree production files
were unchanged as HEAD advanced during investigation. `probe.mjs` archives that
explicit Git commit's regular `src` files, bundles only archive modules, and runs
34 direct VFS/native pairs plus an actual default-registry Shell invocation.
`RESULT.json` records raw status/stdout/stderr, inputs, source inventory, loaded
module names, binary hashes and build identity. Nothing imports live product
source or a pre-existing dist output.

**34 completed pairs: 26 exact byte/status matches, 8 differences; no skips.**
These are investigative observations, not 34 acceptance assertions:

- Five connector-only differences: `LC_ALL=en_US.UTF-8`, UTF-8 `LANG`, UTF-8
  `LC_CTYPE` over C `LANG`, empty `LC_ALL` falling through to UTF-8 `LANG`, and
  `TREE_CHARSET=UTF-8` under C. Native selects Unicode branches; ours ignores
  the environment and selects ASCII.
- Two Unicode-filename differences also involve filename escaping and Darwin
  libc collation, not just branches. With native `en_US.UTF-8`, the observed
  names are raw Unicode and ordered `雪.txt`, `é.txt`, then `line\\012feed`.
  Ours sorts UTF-8 bytes and octal-escapes non-ASCII names. Switching branch
  glyphs must not be reported as resolving these two rows.
- One mixed-root display difference: native annotates an explicit ordinary
  file operand `[error opening dir]` with status 0; ours prints the file without
  that annotation. The totals still match. This is not a count defect and is
  outside the requested branch/count change.

All **15 count probes agree on totals**, including empty root, populated root,
empty child directory, hidden-only root, `-a`, all-filtered `-I`, unmatched `-P`,
`-d`, `-L1`, repeated operands, mixed directory/file operands, JSON and directory
symlinks with/without `-l`. Fourteen of those also match complete output; the
mixed-root annotation accounts for the remaining whole-output mismatch.

Concrete original fixture (`tree-input/a.txt`, `tree-input/sub/b.txt`):

| Invocation/profile | Branches | Report |
| --- | --- | --- |
| Current command, `LC_ALL=C` | ASCII | 2 directories, 2 files |
| Native 2.2.1, `LC_ALL=C` | ASCII | 2 directories, 2 files |
| Native 2.2.1, `LC_ALL=en_US.UTF-8` | UTF-8 | 2 directories, 2 files |
| Native 2.2.1, C plus `TREE_CHARSET=UTF-8` | UTF-8 | 2 directories, 2 files |
| Native 2.2.1, C plus `--charset=UTF-8` | UTF-8 | 2 directories, 2 files |
| Original unchanged breadth expectation | UTF-8 | 1 directory, 2 files |

The original recipe is authored in
`benchmarks/reports/baseline-only-20260827/coverage-execution/cases.mjs:77`;
its environment is C (`:96`). It is not an authenticated native capture.
`next-handoff/targets.json` preserves both engines' exact failures. No original
row is reclassified as a pass by this investigation.

## Primary provenance and interpretation

The available oracle is upstream **unix-tree**, not a GNU coreutils utility:
tree 2.2.1, Darwin arm64 25.4.0, recorded Apple clang 21.0.0 build. Binary SHA256:
`34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`.
Official archive SHA256:
`e911c4a2bea53586cc7be6f3d7d7f4d9c2f2bcbbad77d30700b31046e38f4bc5`.
The existing build and archive were hash-verified before these fresh invocations;
five relevant source/manpage files also equal the archived bytes. We did not
rebuild that binary or attest its original download independently. No native
2.0.4 or Linux binary was executed.

Primary upstream references inspected (URLs are literal provenance data):

```
https://gitlab.com/OldManProgrammer/unix-tree/-/archive/2.2.1/unix-tree-2.2.1.tar.bz2
https://raw.githubusercontent.com/Old-Man-Programmer/tree/2.2.1/CHANGES
https://raw.githubusercontent.com/Old-Man-Programmer/tree/2.2.1/list.c
https://raw.githubusercontent.com/Old-Man-Programmer/tree/2.2.1/tree.c
https://raw.githubusercontent.com/Old-Man-Programmer/tree/2.2.1/color.c
https://raw.githubusercontent.com/Old-Man-Programmer/tree/2.2.1/doc/tree.1
https://raw.githubusercontent.com/Old-Man-Programmer/tree/2.0.4/list.c
```

- `CHANGES:97,146` explicitly records the operand-total change in **2.1.0,
  December 26, 2022**. 2.2.1 `list.c:101-127` adds a populated root to accumulated
  totals; 2.0.4's older `emit_tree` has no root increment and different
  multi-operand accumulation. Do not emulate that entire older implementation
  accidentally by simply subtracting one from the final total.
- `tree.c:152-160` initializes the actual host locale and determines Unicode
  line drawing from its codeset if `getcharset()` supplied no value.
  `color.c:313-324` reads `TREE_CHARSET`; explicit CLI charset is processed later.
- `doc/tree.1:192` defines `--charset` for line drawing/HTML, **not** a switch
  controlling filename escaping or collation. The source plus fresh text probes
  demonstrate `TREE_CHARSET` affects text, despite the manpage environment
  summary mentioning HTML only.
- Empty or unknown `TREE_CHARSET` selects ASCII in this native profile, rather
  than falling back to a UTF-8 locale. An invalid installed locale name such as
  `not-installed.UTF-8` does not become UTF-8 just because of its suffix.

Native evidence is platform/version-qualified. POSIX does not specify the tree
utility; this proposal does not claim POSIX requires one report count or connector.

## Concrete implementation plan for authorization

1. Add `src/commands/tree/charset.ts`, used by `arguments.ts` after explicit
   charset options have been resolved. Select only from **own entries of
   `CommandContext.env`**, never `process.env`, a host locale query or a config
   file. Precedence: explicit last `--charset` > present `TREE_CHARSET` > first
   nonempty `LC_ALL` / `LC_CTYPE` / `LANG` > deterministic C/ASCII fallback.
   Preserve empty `TREE_CHARSET` as an explicit ASCII choice. Add verified
   `US-ASCII` / `UTF8` aliases only after fresh native neighbor capture; existing
   ASCII and UTF-8 flags continue to work. Unknown explicit flags remain errors.
2. Define a small, explicit virtual locale codeset table for the first increment:
   C/POSIX and C.UTF-8/C.utf8/en_US.UTF-8/en_US.utf8, validated against available
   native profiles. Other names use the documented ASCII fallback; do not invent
   host-installed locale availability from a `.UTF-8` suffix. A later broader
   locale table needs its own decision/evidence. The primary useful workflow is
   C byte sorting/escaping plus `TREE_CHARSET=UTF-8`, which matches native output
   without libc collation emulation or unsafe raw-name output.
3. **Keep** `tree.ts:137` populated-root counting and its JSON/text shared totals.
   Add explicit count acceptance tests rather than changing correct code. No
   legacy mode is part of this initial approval request. Keep `-i`, `-J`,
   `--noreport`, filtering, depth, alias traversal and cycle handling unchanged.
4. Update only `src/commands/tree/README.md` and the help in `arguments.ts` to
   describe the new selection behavior and accurate current public integration.
   Do not change root exports, manifests, plugin/default registry or contracts.

New focused author test paths:
`tests/commands/tree/charset-selection.test.ts` and
`tests/commands/tree/report-counts.test.ts`.
Independent reviewer-owned holdouts should use a new
`tests/commands/tree-breadth-stress/` directory, not rewrite sealed stress data.
Keep `tests/commands/tree/native-fixtures.json` and the original comparison
captures immutable; add a new versioned native charset capture if needed.

Required controls: explicit/env precedence including empty and inherited keys;
ambient-host-env isolation; C/UTF-8 branch byte comparisons; invalid/huge env
values admitted before scans; no FS calls on usage refusal; every count neighbor
above including multiple roots and JSON; direct plugin plus actual default Shell
pipeline; ASCII-vs-UTF8 exact output caps, delayed/backpressured sink, caller-abort
reason and no post-abort writes; old traversal/alias/permission/work-budget
tests unchanged. Mutants must catch always-ASCII, always-UTF8, ignored explicit
override, environment fallthrough error, unconditional root increment/decrement,
per-root report reset and UTF-16 rather than UTF-8 output charging.

## Boundedness, exclusions and replay

No new I/O capability or permissions needed. Environment selection reads at most
four relevant keys, with constant-time length admission before scans/uppercasing;
charge admitted bytes/work to existing limits, not a new budget. Skip unused env
branches after an explicit charset wins. Existing `WalkBudget.emit` must continue
charging actual UTF-8 bytes: a Unicode branch is larger than its ASCII equivalent.
Preserve 16-KiB owned writes, awaited backpressure and partial-output policy.
Do not emit user-provided charset text as a terminal sequence. Do not change
filename control escaping, compareEntry trust, ancestor-only cycle detection,
visited-entry charging, opaque backend cancellation or any sibling command.
No claim of libc collation parity, snapshot traversal, untrusted-host sandboxing,
all-native compatibility or a fixed historical strict score follows.

Replay: `node benchmarks/reports/tree-breadth-proposal-20260827/probe.mjs` emits
JSON to stdout, creates a unique isolated scratch directory, and removes only
that directory in `finally`. Requires the recorded native archive/binary and
installed esbuild tool; no installs or private-repository reads/writes.
Source and host-fixture pre/post inventories include new entries. Virtual
file-content preservation was checked, **not** a complete VFS namespace/mode
census. Runtime is the recorded installed Node22.22.2; this is not a public
packed-consumer or the earlier Node24 whole-gate profile. There are no retained
owned child processes. Independent implementation verification remains future.
