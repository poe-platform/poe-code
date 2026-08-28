# S54 bounded author repair — 2026-08-28

**Author qualification complete; DIFFERENT review still required.** No public
integration, default registration, Shell change, native Codex oracle or whole-gate
claim. S62/S64/S71/S74 fixture adjudications are not modified or rescored here.

## Frozen inputs and commits

- Original module: `58be2d6c5706f3e90f01d48e695ecfd9daa52669`.
- Original author evidence: `767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5`.
- Source repair: `753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d`.
- Pre-execution source/cases/executor seal: `450d0631` (`SEAL.json`).
- Exact accepted selected base: `8437e4eda904e1248c25eeef0d9d455b1d251495`.
  Only the six named apply-patch module blobs are overlaid. Four source files
  change; `options.ts`/`index.ts` are unchanged. No mutable-HEAD product input.
- Independent original S54 is STATIC_NONCONFORMANCE, not a dynamically failed
  cancellation execution. Its bytes, report and 27/70 HOLD +43 unrun remain.

The genuine issue was bulk8197-byte work/copy before a 4096-unit checkpoint, and
threshold drift. This repair bounds ownership copying and encoding, accounts for
their work before allocation/operations, and crosses each charged interval with
an awaited cancellation-aware checkpoint. Exact source reasoning and caveats are
in `ADJUDICATION.md`; numerical maxima and public module API remain unchanged.

## Actual bounded run

One fresh reproducible isolated build, no reuse of the original temporary root.
No failed attempts before this run and no case amendments after its preseal.

| Layout | Unchanged original author cases | New focused cases | Strict types | Actual loaded product modules |
| --- | ---: | ---: | --- | ---: |
| compiled source package | 63/63 | 16/16 | positive / TS2322 negative / restored pass | 216 |
| offline installed full package | 63/63 | 16/16 | same three checks | 216 |
| physically moved full package | 63/63 | 16/16 | same three checks | 216 |

Original author63 =32 literal +24 supplementary +7 provider-flow cases. ReadOnly
is a required refusal, not a writable-backend positive. This is not a replay of
Arch's original32 or supplementary70 cohort. All source/installed/moved original
cases still use the original probe/case bytes. MockDav remains the original
accepted test helper, dev-transpiled with the same explicit emitted resource-id
import routing; no real-service proof or helper behavior change.

Each main layout disposed all8 original Shells and awaited all17 new direct-command
cleanup registrations. Across the three main layouts:24/24 Shell disposal and
51/51 new direct-command registrations. The final binding-restoration control adds
two more awaited direct registrations; these are not counted as extra main cases.

### Unmodified versus instrumented evidence

Nine focused cases (F01–F07, F13, F14) use unmodified emitted product. They cover
8197-byte edits, multi-byte scalar/chunk boundaries, CRLF/no-final-newline,
inclusive/over-limit files, low work, NUL-before-invalid-UTF8 diagnosis, and raw
sink failure after publication. F03 separately delivers false,0,empty-string,and
one object from a host-read-scheduled immediate: exact caller reason identity,
zero writes, quiet output and original bytes. F04 observes one producer pull and
one finalization when cancellation arrives during owned input copying.

Seven cases (F08–F12,F15,F16) deliberately instrument private Work/prototypes or
allocation. They are **not** unmodified scheduling/allocator/RSS proof:

- F08 observed ownership-copy sizes `[4096,4096,5]` for8197 bytes.
- F09 observed zero destination-constructor calls when8197 copy work exceeded8196.
- F10 observed encode input lengths `[1023,1023,1023,1023,1023,1023,885]` for the
  declared surrogate-boundary string; every call <=1024 UTF-16 units.
- F11 observed charged checkpoints `[4096,8192]` from initial17 plus9000 units,
  final charged9017. F12 observed `[4096,8192,12288,16384]` while scanning/comparing.
- F15 injected abort(false) at private charged4096 with the original S54 file
  contents; bytes/output/reason checks passed. This is a NEW versioned instrumented
  case, not a conversion of Arch's original static row into a dynamic pass.
- F16 observed zero101-byte staging allocations when the complete encoding work
  could not be admitted. This tests admission, not physical memory use.

Four separately loaded emitted mutants were killed: bulk-copy/F08,
skipped-interval/F11, large-encode/F10, removed-stage-admission/F16. Every mutant's
changed bytes were authenticated as the actual load; each restored case passed.
Both negative load controls rejected (unadmitted emitted mutation and .ts source
fallback), followed by a passing restored F01. Their expected nonzero exits are
not unexplained baseline failures. All stderr/stdout and negative results remain
in the capture, including deliberately rejected type checks.

## Full package and source/declaration binding

Full package882 files (858 accepted base +24 new module emissions), zero runtime
dependencies. Whole installed and moved inventory equals the compiled package;
post-control source/emission hashes are restored. Each type run authenticated all
10 admitted declarations and rejected source fallback. Internal module imports
only: no public root export/default wiring claim.

- Full tarball:774520 bytes, SHA-256
  `f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95`.
- Full package inventory JSON SHA-256:
  `01d03893a35401324b1ad93f654e9354cbd7a6bf0bbca3a28fa3b831fe80b8b8`.
- Actual shared.js SHA-256:
  `5394bb37a1ca2af08ab5a57f077dbe738e0d02355da4543fecb6bc6403b09fc3`.
- Actual matcher.js SHA-256:
  `5bebbf4a753b727c2316be7847e50f870daab8b4820e5b256dba10bb4a105f57`.

All six source SHA-256/Git blob IDs, every emitted file, actual load records,
declarations, tools, package tarball and raw child results are in the compact
capture. Source hashes were rechecked unchanged after execution.

Capture: `captures/apply-patch-s54-v2-WB7vny.json.gz.base64` (1213657 bytes).
Encoded SHA-256:`c2e6eab28948ce09c01da25e3da81004a3dccaa4d42004a43d2955a1e1dc6e87`.
Decoded JSON1909471 bytes; SHA-256:
`ff047d37e8f8b92dbe21afd1ab2e6136653a6870f02b1507d09af9b070294815`.

## Resource/cleanup and residual limits

The recipe admitted28 serial children including two data Git processes, plus its
runner (29 total). All children exited naturally; no timeout/forced/unknown exit.
One subsequent bounded data-only capture inspection process (no product import)
brings qualification/data processes to30, below32. Development shell/Git authoring
commands are not runtime/native-oracle children. No parallel command launches;
the existing Node loader worker is disclosed, not guest execution.

Recipe elapsed24899ms (observation, not performance/preemption guarantee), captured
child output2753926 bytes, checked task-root peak retained bytes15950619. These
are output/disk observations, not RSS/allocator/transient peaks. Task-owned root
identity checked and removed, all fixture roots removed, no owned active child.
Only durable scoped evidence remains. No private checkout/native/network calls.

Native allocation can still zero-initialize a byte-admitted8-MiB destination;
native string slices/joins are bounded but not interruptible inside the call.
Work re-accounting may cause earlier refusal at the unchanged maxWork. No promise
of hard host preemption, global deadlines, aggregate RSS or filesystem transaction.
Opaque uncooperative VFS/iterator/sink cleanup retains existing limits. Independent
review should challenge the private work accounting and retained-buffer semantics,
not reinterpret instrumented assertions as universal dynamic guarantees.

Reproduction (offline development tools already present):

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/commands/apply-patch-author-20260828/s54-v2/run.mjs
```

The runner checks the preseal before loading product, recreates only admitted
selected inputs and writes a new uniquely named capture; never overwrites history.
