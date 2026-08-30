# One authorized run — admission HOLD, attempt consumed

2026-08-28. The exact released command ran **once**, with Node22.22.2 and label
`ARRAY-S06-20260828-01`. Coordinator exit **78**, `accepted:false`,
`unsafeStop:true`, `childrenRetired:true`. No retry, guard/cap/permission change,
source repair or substitute composition was attempted. The grant is consumed.

## Release and exact inputs

Root explicitly confirmed the336-byte grant-v4.json SHA256
`49bdcaefe494fdf2bed73a0c48ebe83f6ef75b516ce55e0ffaaa21509f3074f6`,
rootReceipt `28c84d3ec010b1d2508a7ace3dcbb57e17eaf361`, and released one actual
run of the command recorded in PREPARATION-V4.md. That literal command was
invoked with no outer retry loop or alternate arguments.

- Candidate: `c0adae539c736db0e4023d401562ce958d9ebb00`.
- Selected composition: `30f88590b66b88dc9694a56c85f1ee690f02218b`.
- Expected862 package SHA256:
  `e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3`.
- Seal: `c7f198821b82f8ce2661913b944211b747de2bd5a4017c431406687cda212d80`.
- Dispatcher: `ee5f7e1d17d7ce47dc7bdd6de757923180c8bd46add0f854fda960bbbc374807`.
- Actual configured runtime: `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`,
  SHA256 `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
- Git: `/Library/Developer/CommandLineTools/usr/bin/git`; immutable-object
  commands used the sealed repository cwd and the exact isolated environment.

## Exact failure and ownership

Child001 successfully resolved `c0adae...^{commit}` at16:27:05.522–05.589Z,
exit0. Child002 ran at16:27:05.771–05.788Z:

```text
git rev-parse 30f88590b66b88dc9694a56c85f1ee690f02218b^{tree}
```

It exited128 with:

```text
fatal: ambiguous argument '30f88590b66b88dc9694a56c85f1ee690f02218b^{tree}': unknown revision or path not in the working tree.
Use '--' to separate paths from revisions, like this:
'git <command> [<revision>...] -- [<file>...]'
```

The exact assertion is at preparation-v4/dispatch.mjs:50, called at:53.
It requires a successful Git lookup of the selected composition identifier.
That admission failure stops dependents; it is not an ordinary array assertion
that the executor should continue past.

**Static diagnosis: reviewer harness admission defect, not an array product
failure.** The author `s06-v2/validate-repair.mjs:115` computes Git object hashes
in JavaScript. Its `compose` function at:116–139 recursively hashes composed
tree bytes; at:144 it assigns the result to `report.candidateSourceTree`.
This calculation does not publish the composed tree into Git's object database.
`seal-repair.mjs:89` records that calculated identity as `sourceTree`.
The independent runner incorrectly assumed that this calculated identity must
also be resolvable by `git rev-parse`. The actual second-child failure establishes
that it was not resolvable here. No deletion, garbage collection, hostile change
or corrupt product is inferred from that absence.

Those three author files were read-only compared against committed evidence
`90811f46e54b771ee6d30002fd10cb1b5cdf7bc7`, with no differences. SHA256:

- validate-repair.mjs: `c3723ccca831d0fef26618398e33dd61038216e499cb4f3831bfca3b389d1d6e`
- seal-repair.mjs: `0b377a525af1d3fcde4619a7545a98558f3eaf6d1509c90793bc7546dddb6162`
- SUCCESSOR-SEAL.json: `1563390d2c49cc71626faa2c56b3b118b96227e10d9c2c6c85be9c1653f9951a`

The previous preparation-v3/prepare-data.mjs authenticated269 selected source
blobs and the capsule; it did not execute this additional composition-object
lookup. Its historical34 synthetic checks/272 preparation children therefore
did not establish this actual admission prerequisite. Those results remain
unchanged and are not promoted to successful candidate admission.

## Actual coverage — no candidate results inferred

| Stage | This run |
| --- | --- |
| Runtime/grant/seal role admission | Reached and accepted;88 sealed roles remain unchanged after stop |
| Immutable object checks | Candidate commit resolved; computed composition lookup failed |
|269 selected source blob checks / source staging | Not reached:0/269 |
| Capsule/e12 package verification, build, pack, install | Not reached |
| Source/installed/moved semantic33 and holdouts16 | Not executed in any layout |
| Mechanical22, including M21 source-only and five mixed | Not executed or discharged in this run |
| P01–P10 / AST4 / types10 per layout | Not executed in any layout |
|12 mutants plus S06 reversion / positive companions | Zero loads, zero executions, zero kills |
| Product failures proved by this attempt | None; product behavior unmeasured |

No tests were relabeled as passes or skipped to manufacture acceptance. All
33+22 obligations,16 holdouts, operations, AST/types/layout/mutant requirements
remain outstanding. Prior c7 failures, S06 history, H12 original held record,
native qualifications and STACK136/C06partial/S13unsupported remain unchanged.

## Cleanup, capture and bounds

Only **two Git children** launched, PIDs21251 and21253. Both have actual spawn,
close and absent process-group observations, known statuses0/128, no signals,
no spawn errors and no supervisor faults. Active count0; both owners retired.
No compiler/npm/product workers, private engines or native oracle commands ran.

Captured child output:317 bytes. Accounting elapsed718.320209ms; terminal
announcement began at723.072084ms from the same process-origin deadline.
The actual coordinator exited78 after emitting the bound final receipt. No
110-minute reset/tail, capture overflow, timeout or unknown reap occurred.

The source/build/tools/apps/artifacts/scratch directories are all empty. Their
empty final censuses are preserved in FINAL.json, and were checked again after
exit. The run directory and raw records remain retained as immutable evidence
and as the consumed-label marker; they are not claimed deleted. There are no
active owned child processes or staged candidate/tool trees.

All88 sealed source/data roles were rehashed and mode/path-checked after exit;
both grant files and the dispatcher/seal remain unchanged. The old v3 grant is
still UNEXECUTED. No product or foreign staging changes were made.

Raw records retained in `../RUN-ARRAY-S06-20260828-01/records/`:

| Record | Bytes | SHA256 |
| --- | ---: | --- |
| child-001.json |549| `4a6daf67ec296e31b29b16a0692d3ba0c3fc3ce7bd9c8fa9cfe9ee52d3e30692` |
| child-002.json |789| `af15bd19b73dee41599169588053e79f646c640f7829de73e4a10e3f0809fb20` |
| FINAL.json |5368| `0a8f587eb7c32cf4b4410cbfccd2b08c0354b219cb7c32e57e32c5ca18ed872f` |

ACTUAL-TERMINAL.json preserves the emitted coordinator stdout object. FINAL is
explicitly provisional and false; actual exit78 cannot be read as acceptance.

## Minimal proposed next decision — not implemented

Any correction needs new root authorization and a new sealed recipe/grant;
this one-attempt release cannot be reused. Replace the false requirement that
a calculated composition already exist in Git with an independently checked,
finite recomputation of its tree identity from authenticated baseline tree
bytes and the exact269 selected blobs. Do not merely drop the composition
guard, change the selected identity, write unapproved Git objects or substitute
raw HEAD. Exact needed tree-input closure and any revised Git-child accounting
must be specified before such a repair is authorized. No repair/reconstruction
or second dispatcher attempt was performed here.
