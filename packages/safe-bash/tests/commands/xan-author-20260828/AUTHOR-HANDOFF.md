# XAN author handoff — August 28, 2026

## Status and authority

**Source candidate: `0ec84fc38c3fafd75776d80148d4f3c2d77e6247`.**
The complete bounded four-command module is implemented and ready for root-routed
independent review. Final isolated builds, strict internal consumer and **24/24
author test groups pass**. The same 24 groups pass after actual offline packing,
extraction and relocation. This is author verification, not independent acceptance,
public-export acceptance, full native parity, superiority or 72 hours of work.

Normative freeze: `55810d4aea70fadf151c2fbf746a17f96bfeb599`.
Only its public `FINAL-CONTRACT-V4.md` and `FINAL-BINDING-V4.json` were read from
the independent subtree. Adopted selector sections 2–4 at
`5b27c32b941315247bf5dca7b20faf2a9aca6d48` and accepted
`1168432e12568e63ff307e92ed83d64d78a03a3c` supply the declared profile.
The **36 selector expectations (21 valid, seven S/N, eight R), 88 prior
references, 12 control families, 18 cap recipes and seven ratifications remain
PROJECT inventories**. They are not an additive pass denominator or a claim that
this author's 24 groups independently discharge the entire frozen inventory.

No shared API or policy change was made. No blocker was identified for the
approved nontransactional profile. No independent hidden test, independent
review implementation, private checkout or upstream engine source was copied.
Immutable original author oracle RESULTS were read for historical display/error
bytes; this was not native execution. Original 28+16 observations and their tree
compare byte-unchanged with the accepted 116 revision.

## Delivered module

All product writes are under `src/commands/xan/`; author tests/evidence are under
`tests/commands/xan-author-20260828/core/`, plus this handoff. The separate
`assembly/` owner was not edited. Root exports/default commands/package/config,
AGENTS, contracts, providers, runtime and foreign/native artifacts were preserved.

- `index.ts`, `options.ts`: internal factories/plugin, one `xan` registry command,
  immutable validated options, all 18 defaults/hard ceilings, one replacement rule.
- `argv.ts`, `selector.ts`, `sort.ts`: strict argv-only preflight, adopted consuming
  selectors with positional star/quote/occurrence oddities, checked unsigned modes,
  bounded sorting, plural-index deduplication and resolution before publication.
- `csv.ts`, `budget.ts`, `writer.ts`: incremental byte scanner, separate command
  dialects, split BOM/CRLF/quotes, owned retained bytes, capacity/work accounting,
  checked growth, valid EOF/CR/BOM serialization and same-comma faithful raw data.
- `commands.ts`: headers/display/multi-input CSV, count splitter, select and slice;
  finite early stops, ordinary zero-range compatibility and uniform zero-tail.
- `io.ts`: borrowed stdin forwarding, registered idempotent owned cleanup,
  destination-specific output, full-authority identity guards, real `wx`/`w`,
  streaming output and bounded whole-result fallback with simultaneous staging.
- `README.md`: exact flags, limits, unsupported features and lifecycle/VFS limits.

Runtime dependencies remain empty. Product imports no host process, implicit host
filesystem, network fallback, external parser or upstream implementation. Commands
are not automatically registered; no root/public export is claimed.

## Source commits and retained failures

| Candidate | Change | Exact-baseline result |
|---|---|---|
| `056054669b1e0bcf4c5b3990925cdec030ecbbf6` | Initial coherent module and author suite | Baseline build/typecheck 0; candidate build/typecheck 2; no consumer/runtime acceptance |
| `d3fa941db207eead9df6167ac3160ab62ea0ce54` | Fix scanner strict Uint8Array and closure narrowing | Build/typecheck/consumer 0; author 17 pass, one fail |
| `8638b4c8a35878599e50970c83dfaf6f253e78d6` | Work/growth/sort accounting, numeric/row admission, owned cleanup, expanded tests | All commands 0; author 23/23 |
| `75fc3bceb6ea99c8870066055182e8dd269498f4` | Historical header display/error bytes, bounded diagnostics | All commands 0; author 23/23 |
| `4bfc688c9d7b74e8882229bb661018bc236b1843` | Exact stderr failures and opaque cancellation controls | All commands 0; author 24/24 |
| `0ec84fc38c3fafd75776d80148d4f3c2d77e6247` | Explicit output work and checkpointed fallback copies | All commands 0; author 24/24 |

The first failure is an author source/compiler correction. The second is an
author fixture error: the test expected a returned failure status from a parent
Shell output limit, whereas the actual baseline correctly rejects with
`ShellLimitError`. The expectation was corrected to require that rejection;
parent enforcement was not weakened. Later historical-byte corrections changed
source to the immutable recorded observations, not those observations. Both
failed captures, their command statuses and full stdout/stderr are retained beside
the successful captures. Nothing was silently rescored or deleted.

## Exact isolated composition

Baseline is **only** `5137a74ec855a32d8a8860eb66b62eb44d11e290`, plus the
candidate's ten module `.ts` files. The harness includes all 211 baseline source
TypeScript files selected by its real build config and its four exact
package/config inputs. No moving HEAD, concurrent timeout/WebDAV implementation,
root export, package or configuration overlay enters the build. This is a full
baseline build set, not a claimed minimal dependency closure. Author tests/docs
are separate evidence, not baseline product overlays.

Harness: `assembly/assemble.mjs` at
`19332038cd7e0054f1290b3f9cf6f613018b99fc`, SHA256
`b7c813219e1ecfca70c4b4ff790540a50aaf566024afbd9d69dba732518668f7`.

```sh
node tests/commands/xan-author-20260828/assembly/assemble.mjs \
  --candidate 0ec84fc38c3fafd75776d80148d4f3c2d77e6247 \
  --runtime-entry tests/commands/xan-author-20260828/core/compiled.test.mjs
```

Final capture:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/xan-baseline-harness-20260828-8HPo92/receipt.json`.
Its exact original bytes are committed in `core/evidence/06-final-green.receipt.json`;
all command logs are losslessly retained as UTF-8 strings in the adjacent logs JSON.
All six original capture directories and their archives remain present.

| Binding | SHA256 identity |
|---|---|
| Baseline sorted Git/path/source inventory | `591ba6d6d4a83f9910c3906853af664a00904abaca9a0c243386861d15fe553f` |
| Final composed source inventory | `4ec398bc4ae2bbbc15eb0a63b796192619087e9d0e25b8c87524ac7dff9f7df0` |
| Installed locked tool inventory | `79f08addf060bc7ddd85d7be442db4e5c63ee444a6e893d72ca16d3b5baf7227` |
| Moved compiled package inventory | `225d2710a79c003795f501370ff8662828657bed500933572f5a10fae92831ec` |
| Final `baseline.tar.gz` | `ceab65909d2513bb8bb36b256d7b35e0ea895322f7aec738f604af0ec5bcfd69` |
| Final `tools.tar.gz` | `01786ebc3738668b6bd204f699c55fc26eca35b5e03362be1d68388c5c5a578d` |

The final receipt binds every module source blob/hash, all baseline inputs, exact
commands/statuses and locked tooling. Node is v22.22.2 (Darwin arm64), TypeScript
5.9.3, @types/node 22.20.1, tsx 4.23.12, npm 10.9.7. No installs occurred.
Node executable SHA256 is
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.

Source-only baseline and candidate strict build/noEmit checks pass. The moved
strict NodeNext consumer imports the real compiled internal module and checks
factory/CommandDefinition compatibility; runtime smoke also passes. No failed
build's emitted files were used for acceptance. This is **not** repository
`typecheck:all`, canonical whole-suite execution or public export acceptance.

## Actual pack and relocated replay

`npm pack` used the final moved compiled package, `--offline --ignore-scripts
--json`, an isolated cache and a unique pack directory. The baseline package's
actual `files: ["dist"]` was retained. Archive members were checked, extracted,
and compared byte-for-byte to the moved package before replay. Original and
extracted package files were re-enumerated after execution and remained identical.

Archive:
`/tmp/xan-module-author-20260828-pack-daFbtp/virtual-bash-0.0.0.tgz`
(760439 bytes), SHA256
`324268096450f0133265b7003140139fc5118e9e4a39d43ca856ce214918bac7`.
`core/evidence/PACK-RECEIPT.json` preserves npm's receipt, exact commands, stdout,
stderr, archive inventory, source/test hashes and statuses.

```sh
XAN_PACKAGE_ROOT=/tmp/xan-module-author-20260828-pack-daFbtp/package \
  node tests/commands/xan-author-20260828/core/compiled.test.mjs
```

The extracted package contains compiled output and its baseline manifest, not a
live source fallback. Its replay passes the same **24/24 groups**, not 24 extra
independent cases. Pack integrity checks detect added/changed/deleted regular
files and refuse symlinks; empty directories/timestamps are not inventoried.
Harness checks likewise re-enumerate files at checkpoints. Neither procedure
claims append-proof concurrent mutation prevention or a transactional snapshot.

## Tested scope and remaining limits

Author groups cover literal selectors and S/N/R phases, exact good CLI/refusals,
CSV/BOM/CR/EOF across deterministic chunk sizes, reused Buffer ownership, binary
UTF-8 scope, poisoned early reads, ragged/count differences, zero-tail/ordinary
slice ranges, header display/multiple inputs, all 18 factory validations and
reduced-cap refusal recipes, cumulative phases/read-ahead/empty chunks, growth and
fallback simultaneous retention, full-fit diagnostics, exact caller/stdout/stderr
reasons, backpressure, owned cooperative cleanup and failure precedence, opaque
losing promises, Memory VFS aliases/unknowns/dangling links/conditional races,
partial files, absent stream capabilities and actual baseline Shell pipelines and
parent sink limits. Tests contain no native oracle execution.

Remaining qualifications are explicit:

- The full frozen independent inventory and exhaustive default/hard-scale work
  and capacity ledgers have not been independently executed. These author tests
  are meaningful bounded checks, not an all-boundary or all-input proof.
- Logical storage/work accounting is not RSS, allocation instrumentation or a
  deadline guarantee. Inherited sink/provider policies remain authoritative;
  no new global file-quota contract is introduced.
- Owned registered iterator returns must cooperate; an uncooperative registered
  return can delay settlement. Pending opaque next/metadata/write promises do not
  acquire a universal drain/preemption guarantee. Completed effects cannot be undone.
- Same/unknown identity refusals and conditional creation do not create an
  identity-conditioned open, lease, transaction, ABA defense or rollback.
- No deployed provider, real-service matrix, full native compatibility,
  performance comparison, superiority, default integration or public export
  acceptance is claimed. Root must route the different reviewer.

Observed captured validation runs span 2026-08-28 04:44:59.988Z through
05:00:56.771Z, with packing afterward. The first implementation commit is
2026-08-27 23:44:54-05:00. These timestamps do not establish continuous active
work or the requested 72-hour project duration. All author-owned tool processes
settled naturally; no SIGSTOP or background worker was used.

Evidence manifest SHA256:
`fa90038de2587e76cdfc2e899f912897da0e131d7d67e3a929675d353df55be1`.
Pack receipt SHA256:
`46319244e7f90c2f358e0efd297bb66dff6043aba8f248c8f8373ee74316b915`.
The separate evidence commit seals this handoff and the explicit evidence files;
the source candidate remains the full commit stated at the top.
