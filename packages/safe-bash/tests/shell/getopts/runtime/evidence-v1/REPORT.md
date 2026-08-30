# Stage2 author checkpoint — August 27, 2026

Source/tests candidate: `618d8967009117547ab476256bc6eb0a9463309a`.
This is author validation, including author replays of older independent
owned-output fixtures, **not Locke's independent acceptance**, a full gate,
native parity, deployed-service acceptance or product completion.

## Exact scope and seams

Only `src/shell/runtime.ts` and `src/shell/shell.ts` change production. The
private helper, contracts, arithmetic/parser, root exports/package/AGENTS and
the earlier owned/independent getopts evidence remain unchanged. O060 stays
deferred; no DU candidate inputs are edited. No reviewer or native Bash children
were spawned. Root's current authorization supersedes the historical reservation
in f9d8737b without rewriting that design.

- `runtime.ts:148`: internal GetoptsBinding/SavedVariable/State metadata only.
- `runtime.ts:271`: deep state/cursor/saved-local clone; exact binding snapshots.
- `runtime.ts:355`: checked write origin, successful-store reset and scalar
  integer OPTIND attribute; existing arithmetic evaluator, no generic declare.
- `runtime.ts:1120`: fresh interpreter defaults separated from invocation clones.
- `runtime.ts:1607`: regular builtin adapter over unchanged private scanGetopts;
  selected argv admission, existing Budget/signal and interruptible checkpoints.
- `shell.ts:149`: fresh exec OPTIND/OPTERR defaults with inherited export bits.

No public contract/API/export or plugin count changes. Discovery reports a
regular builtin. Function-local OPTIND restores the function-entry cursor;
source/eval/group state shares, while subprocess/pipeline/substitution/invoke
clones isolate cursor and saved metadata. D03 reconciles final effective binding
presence/value, not intermediate host map operations. Prefix restoration uses
the exact saved state, not an ordinary assignment hook.

## Author results

| Exact committed candidate check | Result |
| --- | --- |
| New getopts runtime tests | 83/83, zero skip/todo |
| Source strict types | Pass |
| New runtime strict types | Pass |
| Existing owned-output author strict types | Pass |
| Existing owned-output author operation/shell/network | 42/42 |
| Existing core cohort, after required isolated build | 505/505 |
| Existing state cohort | 203/203 |
| Unchanged older independent owned-output fixtures, author replay | 36/36 |
| Moved public consumer strict types | Pass |
| Moved public runtime | 9/9 profiles inside one Node test file |
| Actual SafeJS surface/lifecycle/controls, author replay | 8+11+6 = 25/25 |

No shared `dist` build. Product source/tests come from the committed selected
archive, never live overlays. The source build and moved package are inside
`/tmp/safe-bash-getopts-runtime.o2dO2H`. Installed public TS/tsx tooling is
explicitly reused; no downloads or dependency installation. RUN.json records
exact command arrays, executable/tool hashes and environment overrides. The
bounded replay scripts remain opt-in, not canonical test discovery.

The SafeJS supervisor changes only current candidate authentication and task
temporary locations. Frozen guest/case/revision/assessor/prerequisite bytes,
private preconditions, loader closure, watchdog/output/heap limits and
stop-on-nonpass rules remain unchanged. Each actual cohort has fresh matching
private snapshots: HEAD/tree/index/status/staging, six metadata inputs and264
eligible engine records. Each actual child authenticates63 copied engine files.
Private source is read-only; no engine bytes are committed in this evidence.
All actual child records are closed, with no known live children.

## Preserved failed attempts and corrections

- Development first state run:31/34. Three author fixture defects were corrected:
  generated `;;`, an incorrect octal-error wording assertion, and registry names
  read before async plugin setup. The original TAP remains; it is not candidate
  acceptance and no production fix was made for these fixtures.
- First archive core:487/505. The18 failures lacked the compiled regex worker
  because the author driver built **after** running core. After that same
  candidate's isolated build, the exact unchanged core command passed505/505.
  The reusable driver now builds before tests; first raw failures remain.
- First36 owned-output replay children were blocked by the loader's path guard:
  `/tmp` versus Darwin's resolved `/private/tmp`. No fixture executed. Binding
  the same moved package to its resolved path produced36/36. Assertions and
  loader bytes were not relaxed; both attempts remain.
- First SafeJS preparation omitted the sealed public `profiles/SAFEJS.json`
  prerequisite. The supervisor recorded8 blocked surface rows, zero engine
  runs and matching private before/after snapshots. A fresh v2 task directory
  includes that exact committed file; the25 actual profiles then pass once each.
  The first preparation failure remains, not relabeled as a runtime pass.

## Preservation and profile limits

`PRESERVATION.json` records exact baseline/new hashes. All26 accepted owned-output
added lines in the two production paths remain verbatim. All243 original
protected filenames match their initial hashes. That live-file check does not
claim an append-proof whole repository or freeze concurrent owners' changes.
The selected archive, source/test inputs, built output and moved packages have
separate before/after inventories including new entries. Tool links/generated
outputs are explicitly distinguished. No whole shared-dist before inventory
was taken; the claim is that no command built there, not a fabricated hash gate.

| Path | SHA-256 after |
| --- | --- |
| src/shell/runtime.ts | c746e4cee0f5245d94bba2082ce72b62fdc3b251fd400ee247371fa44dfed722 |
| src/shell/shell.ts | 2c704d4934889d12836e441112b11f41a4e3cdf6cf1ce96f9db42b4b70cdb332 |
| src/shell/getopts.ts, unchanged | bf0bcfd9f370861504e9561c54cfd12c8706663ee7dc3ca8a28b70f66290e9ee |

Readonly protection is deliberately stronger than Bash: first checked failure
stops after earlier scanner/publications, with no unchecked OPTARG deletion,
later writes or rollback. N04 differs even on successful temporary-prefix
restoration. Ten frozen nonfailure stdout facts are reused, correctedN05 is
separate, and readonly/N04 policy tests are not native rescoring. Original16
scripts/14 original5.3 expectation matches, N05/N13 corrections, Bash3.2 history,
and original124 native observations stay intact. These are not124 runtime passes.

ASCII option characters only; ordinary Unicode argument values work. Non-ASCII
option/specification input is an explicit refusal, not byte/codepoint faux
parity. Bounds remain per-word/shared-field admission with saturated private
per-call scanner caps. Scanner work does not count as extra commands/loops or
introduce deadlines; actual caller AbortSignals provide timeout cancellation.
Parser diagnostics use virtual invocation identity and silent paths do zero IO.
No claim of all Bash coercions, arrays, generic declarations or broader profiles.

Remaining: Root/Locke independent candidate review and release decision. This
checkpoint does not implement O060 or broaden the approved getopts profile.

## Reproduction and sealed bytes

Run from the repository, using an installed Node and existing development tools:

```sh
scratch=$(mktemp -d /tmp/safe-bash-getopts-runtime.XXXXXX)
node tests/shell/getopts/runtime/validate.mjs "$scratch"
node tests/shell/getopts/runtime/supplemental.mjs "$scratch"
node tests/shell/getopts/runtime/safejs-replay.mjs "$scratch"
node tests/shell/getopts/runtime/verify.mjs
```

The SafeJS command additionally requires the explicitly pinned installed Node24
binary and exact approved read-only private source profile; it stops rather than
installing, downloading or ignoring drift. The first three commands create new
task-only capture output; verification reads committed evidence. `seal.mjs` is
an explicit author capture tool, not part of replay or canonical tests.

`RAW.json.gz.base64` contains440 captured files (raw TAP/logs, command records,
failed attempts, public driver binding bytes, import audits, private hash-only
snapshots and reports). MANIFEST.json authenticates compressed/raw and per-file
bytes; PRESERVATION.json binds scope, hashes, profiles and exact denominators.
Source and immutable fixture provenance is Git-based; original pinned native
binary provenance remains in the unchanged Phase1 design archive.
