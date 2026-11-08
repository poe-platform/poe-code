# Root authorization record — preparation only; dispatch HOLD

Date: August 28, 2026. Authority: the current root user instruction to this
delegated leaf. Ownership is limited to this new record, `GO.json`, and
`PARENT-BUDGET.json` in this directory. Root coordinates; no worker is dispatched.

## Exact root authorization

> ROOT USER AUTHORIZATION (preserve exactly, no invented priorpool): prepare ONE fresh priority-workflow grant from GO-v3.template.json raw SHA2569f84baf5a92e31e9824abc6a8bba23e1254d45fdf4400f6fa80d7705f67acef9, change ONLY decision from PREPARATION_ONLY_NOT_A_GRANT to GO; allotherfields/formatbytes exact. Seal00ee97d8617eb75a4ac47bf383b19c186a12a8fcd4144096fd08a54d2f2d45ea; packet5d432becbe385eb323c10feecfa5e982bfd3b099; rootfuture-run-01; acceptedcoherent78 derived8437e4eda904e1248c25eeef0d9d455b1d251495/full858SHA6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e unchanged. Source2a63780fd8ddd8bd97b6f2ad31ac33e969da5bae/seal a63169d1/restorationd27096d1 remainsfrozen. No currentGit/apply/arrays or movingHEAD source.

> ROOT newly issues EXCLUSIVE LOGICAL reservation owned by this run, NOT previously-existing/inheritedpool ormachinequota:

```json
{"schema":"exclusive-parent-reservation-v1","id":"priority-command-workflows-20260828/future-run-01","deadlineEpochMs":1788026556000,"remaining":{"children":100,"workerStarts":372,"loaderThreads":97,"captureBytes":419430400,"scratchBytes":536870912}}
```

This is newly issued root-owned EXCLUSIVE LOGICAL capacity for this run, not a
claim of a previously existing or inherited pool, machine quota, or measured
available host capacity. No other task may borrow these counters. No replenishment
or reset is permitted across cases or layouts. Unused escrow returns only after
complete authenticated reconciliation. Unknown reservations remain withheld;
unknown is not zero, complete, or reaped.

## Procedural dispatch hold

**ROOT MUST CONFIRM BOTH FILE HASHES BEFORE ANY DISPATCH. This preparation
authority DOES NOT authorize dispatch. The `GO` field alone does not override
this procedural HOLD. Root confirmation is pending, not inferred or supplied by
this leaf.** The sealed interface does not implement this additional procedural
hold; the coordinator must enforce it. No supervisor, runtime entry, subject, or
actual `future-run-01` root is launched or created by this preparation.

## Exact new file identities

| File | Raw bytes | Raw SHA256 | Regular-file mode |
| --- | ---: | --- | --- |
| `GO.json` | 3492 | `5ca5a1e9847c3306cf49f0f4894d8a6bf83dc39e2741ad49067bdc43148b4aa5` | `0644` / Git `100644` |
| `PARENT-BUDGET.json` | 301 | `86e8f86c74aad9f721b266ce49c6799285daeb8e56577da180017844a81f3dd0` | `0644` / Git `100644` |

`GO.json` is the raw frozen template with the single decision value token
`PREPARATION_ONLY_NOT_A_GRANT` replaced by `GO`: 26 bytes removed, every other
byte unchanged, including whitespace, field order, and final LF. The parent
reservation uses ordinary JSON with two-space indentation and a trailing LF;
its complete keys, values, and counters are exactly those authorized above.

## Immutable bindings and interface compatibility

- Template: `GO-v3.template.json`, 3518 bytes, raw SHA256
  `9f84baf5a92e31e9824abc6a8bba23e1254d45fdf4400f6fa80d7705f67acef9`.
- Seal: `PREPARATION-SEAL-v3.json`, 20766 bytes, raw SHA256
  `00ee97d8617eb75a4ac47bf383b19c186a12a8fcd4144096fd08a54d2f2d45ea`.
- Frozen executable source commit: `2a63780fd8ddd8bd97b6f2ad31ac33e969da5bae`.
  Ordered fourteen-file code-set SHA256:
  `8d1cd6efee03426e726751175c1c2439323a24c82203b2d70b3da482527b0261`.
- Seal/evidence commit: `a63169d1d84f4d81812cafa3b58c1e0624090c3e`.
- Restoration commit: `d27096d15d4082f16a724c87ae116c2da4a0042d`.
  `unexecuted-accounting-followup-data-v1/RESTORATION-RECEIPT.json` SHA256:
  `da7c2809da3212d318430bca14790915c08cfd3dc973176b0454e28e3cc9b646`.
- Original packet: `5d432becbe385eb323c10feecfa5e982bfd3b099`.
- Accepted coherent78 derived composition:
  `8437e4eda904e1248c25eeef0d9d455b1d251495`. This derived identity need not
  name a stored Git object; no stored-object existence claim is made for it.
- Full858 package SHA256:
  `6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`.
  These are unchanged authenticated data bindings, not a new archive replay,
  package build, service acceptance, or moving-HEAD product qualification.

Static inspection preceded creation. `future-supervisor.mjs:20` through its
reservation checks at `:38` accepts exactly `schema`, `id`, `deadlineEpochMs`,
and `remaining`; the latter has exactly the five authorized counter keys.
It requires the stated schema/id, safe-integer deadline and nonnegative
safe-integer counters, at least 100 children, 372 Worker starts and 97 loader
roles, and sufficient scratch for the terminal reservation. The provided values
meet that data shape. `future-supervisor.mjs:27` computes the minimum of the
parent deadline and run start plus `bounds.windowMs`; `admission.mjs:16` fixes
that window at 1200000 ms. Admission still checks expiry at actual run start.

The interface has no prior-pool identity, inherited-provenance assertion, or
external pool lookup. It clones the supplied remaining counters at
`future-supervisor.mjs:29`; this permits the newly root-owned reservation without
inventing previous capacity. Existing inherited-budget wording in
`REPAIR-PREPARATION-v3.md:100` is historical preparation wording, not evidence
that such a pool existed. This record supplies the new explicit root authority;
it does not edit that sealed document or the interface. `admission.mjs:65` and
`:83` bind the exact grant and command to the seal; data-shape compatibility
alone neither authenticates authority nor releases the procedural hold.

## Exact future command — recorded only, NOT executed

Required cwd: `/Users/kjopek/Workspace/safe-bash`.

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/integration/priority-command-workflows-20260828/future-supervisor.mjs --grant /Users/kjopek/Workspace/safe-bash/tests/integration/priority-command-workflows-20260828/GO.json --budget /Users/kjopek/Workspace/safe-bash/tests/integration/priority-command-workflows-20260828/PARENT-BUDGET.json
```

The single-use root remains
`/Users/kjopek/Workspace/safe-bash/tests/integration/priority-command-workflows-20260828/future-run-01`.
The exact three layouts and their public import specifiers remain unchanged in
`GO.json`; no live product source or current Git/apply_patch/arrays is substituted.

## Bounds and evidence qualifications

- Deadline `1788026556000` is root-goal creation `1787767356` epoch seconds plus
  72 hours: August 26, 2026 at 18:02:36 UTC to August 29, 2026 at 18:02:36 UTC.
  It is a planning endpoint, not proof of 72 hours worked. The effective
  cooperative window remains at most 20 minutes from actual run start and is
  shortened by the parent deadline. Individual limits sum to 35 minutes
  20 seconds, so some subjects may remain unrun. No completion guarantee follows.
- Future maxima: 93 real public calls across 31 cases and three layouts;
  100 direct children (3 setup, 4 admissions, 93 runtime); 101 OS-process
  lifetimes including the supervisor; peak two direct supervised OS processes
  including that supervisor. These are future ceilings, not observations here.
- 372 product Worker starts, at most four per runtime child and two concurrent
  product Workers, are distinct from 97 loader roles. Unknown starts remain
  unknown and their reservations withheld, not declared reaped. See
  `admission.mjs:105` and `:111` for escrow/reconciliation logic. OS-process
  reaping is not an independently observed per-loader exit receipt.
- Runtime/admission child limit is 20 seconds; setup limit is 60 seconds.
  Combined per-child capture is 4194304 bytes; parent capture is 419430400 bytes.
  Scratch is sampled logical storage, capped at 536870912 bytes, with the
  existing 16777216-byte terminal reservation inside that cap, not extra capacity.
  This is not a kernel quota, RSS bound, all-native-thread bound, arbitrary
  host-work preemption, or a hard post-SIGKILL close/settlement guarantee.
- The two-second cleanup limit belongs to the Worker observer
  (`worker-observer.mjs:86`), NOT a Shell wrapper or universal cleanup deadline.
- Instrumentation is NOT transparent. Requested product Worker `execArgv=[]`;
  effective options add `--import` of sealed `worker-preload.mjs`, with
  synchronous same-thread load hooks. Entry/module bytes and `resourceLimits`
  remain unchanged (`worker-observer.mjs:19`, `:20`; `admission.mjs:77`).
- Author42 (9 parse-only, 29 DATA/SYNTHETIC, 4 benign controls) and independent13
  DATA checks are historical preparation proof only. They are not newly run
  tests or product calls; all 93 actual future product calls remain unexecuted.

## Preparation scope and verification

Live applicable parent/repository AGENTS rules were read; no narrower AGENTS
file applies to these three files. Before creation, `lstat` found all three
owned paths and `future-run-01` absent, including absence of dangling symlinks.
Repository, tests, integration, and packet directories were nonsymlink
directories. Newly created files are regular nonsymlink files.

Verification is DATA ONLY: raw template/seal hashes; all 99 seal file byte/hash
pins; ordered code-set hash and fourteen immutable source-commit code pins;
template/seal bytes against the seal/evidence commit; seven original manifest
entries plus the manifest against the packet commit; restoration-receipt bytes
against the restoration commit; unchanged target bindings; exact GO byte delta;
exact parent schema/values/serialization; modes and fresh-root absence. No
harness module was imported or invoked, even for validation. No broad archive
audit or new source reconstruction was performed.

Only the three new owned paths are eligible for one explicit atomic DevGit
`git commit --only` commit. Existing tracked/index state was clean before
preparation; unrelated untracked work and native artifacts are not owned and
must remain untouched. Concurrent unrelated commits advanced repository/index
metadata during preparation; no unchanged global-index snapshot is claimed.
The owned scope remains exactly these three files. No broad staging, branch creation, reset, or clean is
authorized. The sealed source, template, limits, cases, and old evidence remain
unchanged. DevGit metadata/commit operations and the host `apply_patch` editing
tool are authorized; product Git/apply_patch execution is not.

No product import/call, build, install, test, native oracle, comparator, private
integration, network use, XAN, arrays, YQ, worker dispatch, supervisor/runtime
launch, or future-run root creation occurs in this preparation. No background
task is started. The CLI owns the final files; this record does not authorize
additional preparation changes, a lifecycle/resource framework, or execution.
