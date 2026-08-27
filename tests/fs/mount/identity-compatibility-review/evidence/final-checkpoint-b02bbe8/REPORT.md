# Final requested frozen FS checkpoint

Source `b02bbe855b6b45d635b521e3dc2f31ea2b04e215`: original acceptance remains
**31/38 positive workflows plus 5/5 rejection controls**. Qualified-input
diagnostic is **38/38 positives plus 5/5 controls, with typecheck exit 0**.
These are different input configurations, not equivalent acceptance cohorts.
Full FS integration remains open: seven original workflows and two matrix
rmdir workflows still fail their unchanged success expectations.

## Fixed revision and preservation

The baseline was committed first as `e3acebe`, retaining all 307938f captures,
93/95 initial Real results, 94/94 same-archive Real replay, and qualified runtime
43/43 with two TS2345 errors. Every one of the 160 previously owned files at
that commit is byte-identical after this final run. Earlier 4fa, frozen59,
moving-worktree and committed9982b9c evidence remains separately labelled.

This new pin was current committed HEAD at final freeze. It includes Memory
late-authority `2926891`, S3 late-authority `eb4a242`, WebDAV `7bce86a`, core
`0bee8e7`, and contract `5076b32`; full ancestor IDs are in the manifest. FS and
contracts were clean. Six unrelated structured-command files were dirty in the
live checkout, recorded in the manifest but never copied into this archive.
This is not a globally clean moving-worktree validation.

- Archive SHA256: `6244531a117e5e81dbc532a4dba3ec2bbb06a3158b388997bb6847cfdca8155d`.
- Source-set SHA256: `ddc369b8b7cc9ec8323a62c99afbf2762503887df9397b1ecafde935129d3cef`.
- Original43 SHA256: `9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
- Qualified diagnostic SHA256: `0921c03b90733b163327888cf54b491207dd7d266bb911ec00fcf77dc88280fd`.

`manifest-before.json` supplies individual hashes for all 156 source files
(all seven FS implementations, core and contracts) and all 282 archived inputs.
Each of the 20 command result JSONs records the same source-set hash before and
after execution. Acceptance input hashes and restored-diagnostic input hashes
match the initial archive. No source, original test, expected output or status
was edited. `artifact-sha256.json` seals this report, raw outputs and runner.

## Exact counts, one final replay

| Cohort | Pass / total | Fail |
| --- | ---: | ---: |
| Unchanged original43 | 36 / 43 | 7 |
| Original positive subset | 31 / 38 | 7 |
| Original rejection subset | 5 / 5 | 0 |
| Original guards | 4 / 4 | 0 |
| Required guards | 49 / 49 | 0 |
| Memory live backend | 143 / 143 | 0 |
| Real live backend | 94 / 94 | 0 |
| Mount live backend | 209 / 209 | 0 |
| Readonly live backend | 103 / 103 | 0 |
| Overlay live backend | 184 / 184 | 0 |
| S3 live backend | 254 / 254 | 0 |
| WebDAV live backend | 526 / 526 | 0 |
| Shared conformance | 202 / 202 | 0 |
| S3 policy | 86 / 86 | 0 |
| Remote cancellation | 24 / 24 | 0 |
| Eight diagnostics | 8 / 8 | 0 |
| Current required-names matrix | 77 / 79 | 2 |
| Live adapter stress, eight top-level entrypoints | 99 / 99 | 0 |
| Approved advisory S3 policy, separate entrypoint | 7 / 7 | 0 |
| Qualified diagnostic runtime only | 43 / 43 | 0 |

Original scoped FS types and qualified diagnostic types both exit 0. All test
cohorts have zero skipped, todo and cancelled tests. Seven backend groups total
1513/1513 executions, but do not add overlapping guards, conformance and safety
cohorts into a unique-test total. No identity-authority-review tests were selected;
the separate independent verifier's 79-case replay is not this leaf's evidence.
The live Memory/S3 suites include their current author tests; no new late-error
proof was invented or duplicated here. All selected commands ran once at this pin.

The 99/99 stress result uses the current approved S3 advisory-mode expectation;
it does not erase historical 98/99 or establish POSIX permission enforcement.
The prior original diagnostic 71/79 is not relabelled as current matrix 77/79.

## Unresolved original workflow identifiers

All seven retain expected success. The isolated qualified configuration passes
these exact same assertions. `case-map.json` maps every one of the 43 cases and
includes full ordered operation traces, exact errors and failed-case bytes/
namespaces before and after, rather than accepting any error as success.

| Original identifier | Current phase |
| --- | --- |
| REQUIRED s3 one-mount copy, target existing | Mount unknown-existing-target guard |
| REQUIRED s3 separate-clients copy, target existing | Mount unknown-existing-target guard |
| REQUIRED s3 separate-clients cross-mount mv, target existing | Core authoritative-distinctness preflight |
| REQUIRED memory to-remote s3 copy, target existing | Mount unknown-existing-target guard |
| REQUIRED memory from-remote s3 copy, target existing | Mount unknown-existing-target guard |
| REQUIRED memory to-remote webdav copy, target existing | Mount unknown-existing-target guard |
| REQUIRED memory from-remote webdav copy, target existing | Mount unknown-existing-target guard |

The six copies return FsError ENOTSUP, syscall copyFile, cause
`ENOTSUP: operation not supported`. One-mount paths are `/source` to `/target`;
the other copies use `/left/source` to `/right/target`. The move exits 1:
`mv: ENOTSUP: existing move destination lacks authoritative distinctness
'/left/source' -> '/right/target'` (exact escaped stderr is in observations).

All seven preserve source payload `[0,255,128,13,10,65,66,67,0]`, old target
`[79,76,68,255]`, sentinels and complete namespaces. S3 traces contain only
listObjectsV2/headObject; WebDAV only PROPFIND. No GET, PUT, COPY, MOVE or removal
is issued for those failing operations. This is safe refusal, not ordinary
overwrite compatibility. It is not a recurrence of the fixed core EXDEV issue;
no new independent core defect is reproduced by these seven cases.

Current compareEntry authority exists: this is not a request to invent another
seam. S3 manual forwarding Proxies lack recognized transport binding. WebDAV
manual forwarding fetches can expose actual protocol resource IDs for remote
comparisons but do not establish the Memory/provider disjoint-storage authority.
Their successful remote-to-remote cases do not make arbitrary fetch wrappers
trusted. Per-instance tokens, URLs, bucket names or credentials are not proof
of disjoint storage. These original input limitations must remain visible.

## Supported defaults and qualified capability tradeoff

Original positive controls pass for distinct memory files, shared backend mounts,
readonly/overlay/opaque distinct wrapper paths, separate Real adapters sharing
one root, and all missing-target remote copy/move variants. Direct S3 copy to
existing distinct keys succeeds even where mount's earlier guard refuses; direct
S3 rename is an explicitly non-atomic opt-in, with its default rejection control
unchanged. WebDAV direct and remote-to-remote existing-target operations pass.
Paired aliases remain protected. This is meaningful positive coverage, not
refusal-only safety evidence, but it is still only 31/38 original positives.

In the isolated diagnostic, both S3 clients use the existing
createS3Transport(service, service.capabilities), and both WebDAV clients use
MockDav.createFetch(). The S3 helper parameter now uses exported S3Client,
matching the actual factory return contract instead of mock implementation
fields. The import adds the factory and type. These six changed lines are the
entire fixture delta, recorded in `diagnostic-qualified-input.diff` and both
full fixture copies. All 30 assertion call sites are byte-identical, with no
cast, output/status change, production edit or additional configuration change.

The final diagnostic is runtime- and type-valid. Prior 307938f diagnostic type
errors remain untouched; this explicitly approved helper correction does not
retroactively turn them green. Qualification requires actual provider-owned or
recognized binding; it cannot safely be inferred for arbitrary user wrappers.
Root/Curie must decide the supported configuration and original workflow
acceptance policy. This report does not replace the original 43-case gate.

## Remaining limits, scope and cleanup

The two matrix failures are S3 and WebDAV `create, copy, append, inspect and
remove files`: rmdir `/work/scratch/nested` returns ENOTSUP. S3 cannot atomically
require an empty prefix; WebDAV lacks a safe portable equivalent. The unchanged
success assertions remain red, with no unsafe recursive-delete workaround.
Comparison is not a transaction, snapshot, lease or ABA/incarnation guarantee.
Unknown final-symlink/source deletion cannot be authorized by followed-entry
comparison alone. Do not infer universal S3 rename atomicity or race safety.

Live enumeration excludes generated evidence, historical Real metadata readers
and the other reviewers' trees. A newly owned short native TMPDIR
`/tmp/sb-final-Z7bZjQ` was used from the first final invocation. The baseline's
socket ENOENT under a long native path and missing historical JSON loader error
remain exactly preserved as harness/environment observations, not waived product
tests; final Real runs all eight unchanged live entrypoints and passes 94/94.

Execution was 2026-08-27 01:50:32–01:50:48 UTC, using Node 22.22.2, tsx 4.23.12
and TypeScript 5.9.3 already installed. No dependencies or new cases were added.
`checkpoint-b02bbe8.mjs` captures the committed archive and refuses to overwrite
this output directory; reproduce in an isolated checkout with a fresh owned
output location, using commands/entrypoints in each result JSON. The standalone
`audit.mjs` verifies evidence without rerunning product tests.

All 20 spawned commands closed, with no timeout or residual process group. Only
this leaf's newly created scratch/native root was removed; no unowned process
was inspected/signalled or temporary path deleted. The owned status at capture
and cleanup contains only this new runner and evidence directory. Final commit
uses explicit `git commit --only` owned paths; no production/contracts/other
fixtures/index entries are included. This completes the requested checkpoint,
not the still-open FS integration goal.
