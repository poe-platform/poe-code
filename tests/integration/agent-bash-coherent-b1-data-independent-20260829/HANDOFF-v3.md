# Qualified B1 DATA recovery acceptance

August 29, 2026. Independent recovered-DATA acceptance only, **not campaign
acceptance or a runtime replay**. The original publisher HOLD is unchanged.

## Bindings and completed audit

- Author recovery commit: `48dca5c3d1cae85faaed22db0e6e358abdd1f975`.
- Exact recovery subtree: `86c0a0693ba0371ad9b8dbc292ad6711874b8ffd`.
- Manifest SHA256: `a0761e51f84c875dd13e2909251be80f0073eb97432f7265ee521a9d98f27551`.
- FINAL SHA256: `89f3c55c91dc664a94df815ef23d5ddbbe6fb7376a1ef5a8e490255c475dd72b`.
- Fresh-binding commit: `7e5502a17a8082da5c6edb25c3737a6aaf63033a`; its explicit
  RECEIPT.json authenticates the same FINAL and UTC window. Its binding-only
  acceptance is distinct from the recovered ROOT actual grant.

`git ls-tree -r -z TREE` authenticated **79 regular Git blobs** with no ancestor
records or symlink-mode admission. The manifest's **34 original files totaling
1,380,268 bytes** match recovered bytes, sizes, modes, collision-safe names and
whole-row identity receipts. All34 original source content/mode/device/inode/
mtime postguards matched before and after controls. Manifest SHA was rechecked.

The one DATA helper exited0. **Six unchanged extracted author control bodies
passed**, plus **three novel controls**: changed-copy byte refusal, changed-copy
mode refusal, and conflicting namespace refusal. Original recovery main and
publisher were not executed. The extracted module is an owned DATA-control
module, not product code. Four tiny synthetic files remain in the explicitly
owned `/private/tmp/safe-bash-b1-data-independent-r3-controls/control-data`.

## Historical observations independently authenticated

| Layout | Case identities | PASS | FAIL | Worker creates / exits |
| --- | --- | ---: | ---: | ---: |
| source-built | C10,C11,C15,C16,C18 | 5 | 0 | 5 / 5 |
| installed | C10,C11,C15,C16,C18 | 5 | 0 | 5 / 5 |
| physically-moved | C10,C11,C15,C16,C18 | 5 | 0 | 5 / 5 |

These **15 recovered outcomes** were derived from the original runtime RESULT,
not merely copied from the author's summary. All15 literal Worker exit codes
are **1**; peak1 per layout, Regex0/internal-loader0 remain recorded values.
Four runtime child retirement records report exited/closed, groupAbsent and
unknown=false. The separate preimport child records exit/close78 with the exact
duplicate-identity refusal. Original outer78 and publisher HOLD remain literal.
The author recovery's seven known starts are not a complete OS census. Runtime
child stream EOF remains **UNOBSERVED**; C16 controlled provider release does not
prove arbitrary opaque finalization or preemption. No new Worker was created.

## Results, preserved failures and publication

Receipt `RESULT-v3.json`: **92,783 bytes**, SHA256
`23361e509ec63d6887758dd3a2fc3e18db6ef5f448bd4b498de18902bd920542`.
Raw stdout:1,558 bytes/SHA256
`8a63bb0bbc6ecf17332ce6df08fa807d951f5c6c7ad87ae16c486773bff3c70b`;
stderr is empty. Both captures and receipt were verified regular and hashed
before publication. DATA reads totaled8,499,302 bytes. Helper finished
2026-08-29T17:22:19.541Z; publication remains inside1788024369000ms deadline.

Preserve215d178c wrong-root comparison, f968dc80 ancestor-guard failure, and all
previous unrun controls literally; this is a new successful cohort. Retained
bytes confirm old commit6ec28c4af9a618f43aeb7f70115628c9041ee961/status0 succeeded
before the old unopened-FD forwarding error. A new ancillary shell mode check
also returned78: its leading-zero constants were not octal in that shell.
That raw capture is retained; a versioned shell-only regular-file/size/hash
check passed. The DATA helper and controls were **not rerun**.

New phase roles: initial shell+scoped Git2; inspection shell1; patch shell/tool2;
DATA launch shell/Node/two Git children4; result-read shell1; failed ancillary
mode-check shell1; corrected capture shell/hash2; handoff patch2; publication
shell/add/commit/status4: **19 known starts**, at most2 simultaneously observed
in this invocation's managed roles (grant peak3). All completed roles returned;
no universal transitive-process census or hard disk/RSS claim. No product,
Worker, compiler, npm, native oracle or source behavior changed. Foreign staging
is not broadly staged; final commit is explicit owned paths only. Local-a HOLD
and Faraday's runtime ownership remain separate and unchanged.

Ancillary raw records: `/private/tmp/safe-bash-b1-data-independent-r3-capture-check`
and `...-capture-check-v2` stdout/stderr. Final publication records use
`/private/tmp/safe-bash-b1-data-independent-r3-publication.stdout` and `.stderr`.
