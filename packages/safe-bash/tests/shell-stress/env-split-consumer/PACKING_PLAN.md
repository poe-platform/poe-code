# Frozen packed-consumer protocol

This phase is preparation only: **zero builds, packs, installs or product
executions**. `consumer.mjs` is syntax-checked, not executed. Its10 native-backed
rows and3 host controls (input control has3 variants:5 host executions total)
are independent of the source author's and hidden verifier's new cases/design.
Those files were not read. API inspection uses committed6e3e316 and current
unchanged package metadata, not the env-S candidate. Prior558d00c remains intact.

## Inputs and expectations

`cases.mjs` precedes native capture. `native-frozen.json` contains both WHOLE
10-row profiles, their literal argv, actual tool/name/source/fixture bytes,
raw stdout/stderr/status/effects, and three separately identified one-optional-
argument controls per profile. Neither profile may be chosen per case. Product
native comparison uses the unchanged complete primary profile; historical
comparison stays complete. Environment enumeration order is never a criterion:
the independently declared NUL-delimited argv/selected-value protocol is emitted
directly by both recorders, not manufactured by sorting captured output.

The non-S header is intentionally both a raw native comparison and an explicit
host-policy assertion. Darwin's actual kernel splits this header; the virtual
policy must retain it as one literal optional argument and refuse126. The raw
native loss must remain visible even if policy passes. The explicit-single-arg
native controls explain that distinction; they do not replace Darwin oracles.
No shell/eval interpretation may be used to implement splitting. The variables
and injection row has literal substitution metacharacters and a marker-effect
check. Selected empty/presence fields, not generic empty-bash-PWD expectations,
test environment boundaries; host input cases additionally require exact
replacement map `{KEEP:"value"}` at the real sink.

## Final READY gate — not executed now

1. Require ROOT's exact committed candidate and actual READY/lease-relinquished
   text. Pin the full commit, tree, runtime/env/parser blobs and contracts.
   Verify every frozen preparation input hash before any product import.
   Inspect the entire committed file inventory; include **every src blob**,
   unchanged package.json, complete tsconfig extends chain, lockfile if present,
   root npm configuration/ignore rules and auto-included README/license files.
   Use a Git archive of those committed paths, retaining the path list, archive
   SHA and per-Git-blob file SHA manifest. Do not overlay missing live files.
   Any missing source/prerequisite stops the attempt with durable evidence.
2. Extract that full source archive into a unique owned temporary directory
   OUTSIDE the repository. Verify no path traversal, unexpected symlinks or
   outside references. Hash source/config/tooling inputs before/load/after.
   Link only the pre-existing development node_modules for the build, recording
   realpath/version/compiler hashes. Run the committed build tsconfig through
   that exact existing compiler, with a hard process-group deadline, scrubbed
   environment and complete actual compiler input list. No tsx in the product
   consumer. Build failure is retained and stops; no repair/live overlay/retry.
3. Remove the build-only node_modules symlink. Verify unchanged manifest,
   exports, name, source/config hashes and emitted-file inventory. Require zero
   runtime dependencies, optional dependencies and bundled dependencies before
   proceeding; also inspect peer requirements rather than trusting only one
   field. Current package is private `virtual-bash@0.0.0`, files=[dist], with
   no runtime dependencies; devDependencies are build tooling only.
4. Run actual npm pack in the archive package with a dedicated scratch cache:
   `npm pack --offline --ignore-scripts --json --no-audit --pack-destination DIR`.
   Use the recorded existing npm CLI/Node, unchanged product manifest and an
   explicit bounded packaging-process role. Preserve raw stdout/stderr/status,
   npm package entry list, integrity/shasum and actual tgz SHA256. Do not call
   this publication. Failure stops; no source/manifest substitution or retry.
5. Independently audit gzip/tar bytes BEFORE installation/extraction. Reject
   absolute/drive/backslash/traversal paths, duplicate entries, symlinks,
   hardlinks, devices and any entry outside package/. Parse or explicitly reject
   unhandled extended headers, checking effective PAX paths too. All file bytes
   must match the archive's emitted dist or unchanged auto-included metadata;
   package.json must match exactly. No live symlink in the distributable.
6. Create a separate clean external consumer directory with its own minimal
   private/type-module package.json. Only this scratch manifest may be written.
   Install the actual local tgz using existing npm, e.g.
   `npm install --offline --ignore-scripts --no-audit --no-fund --package-lock=false --omit=dev --save=false /ABS/PACKAGE.tgz`.
   This is permitted only after the zero-runtime/peer-dependency gate. Dedicated
   cache, no registry/network, no root installation and no inherited NODE_PATH,
   NODE_OPTIONS, npmrc credentials or borrowed node_modules. The installed
   virtual-bash must be a real extracted directory, not a source/package symlink.
   Inventory every installed package/file; unexpected packages stop the run.
7. Copy only hash-frozen consumer.mjs/cases.mjs into the external consumer.
   Run plain Node with strict unhandled rejections, fixed C environment and a
   per-row deadline, once for each10+3 fixture IDs (3 input subexecutions).
   `CONSUMER_PACKAGE_ROOT` names the installed directory, not the build/archive.
   Block product child_process/fetch entrypoints BEFORE dynamic package imports.
   Bare `virtual-bash` and `virtual-bash/contracts` must resolve through the exact
   installed manifest to installed dist JS. Every actual module load must stay
   within that installed dist and match the audited tar/emitted-file SHA map;
   reject TS, outside aliases, foreign file URLs and unexplained extra modules.
   Actual imports source/hash guards are distinct from packaging child processes.
8. Retain raw tuples, middleware args/env/provenance, positive dispatch witnesses,
   parent-state checks, cancellation identity and exact byte output. Compare all
   native rows to both frozen profiles without normalization; report policy
   assertions separately. A harness/load failure is not a product pass. Preserve
   failure and stop on build/pack/install prerequisites or reproducible semantic
   bug; ROOT routes source work. No broad/kernel/accounting reruns in this task.
9. Rehash full fixed archive, installed package and emitted artifacts afterward.
   Preserve compact unique manifests reused by digest and all phase results,
   actual command lines/environment/cwd/source hashes and commit eligibility.
   Copy durable evidence into NEW owned files using apply_patch before cleaning
   only this run's scratch tree/cache/process groups. Never clean other native
   installations. Stop, no polling or author signaling.

## Limits and compiler prerequisites

The driver for steps1–9 is to be added at ROOT's committed READY, not exercised
against live source now. This preparation is **not packed-package proof yet**.
The previous symlink-based built consumer does not substitute for the required
tgz installation. Compiled declarations must exist before any later compiler
check resolving the package's own public exports; the prior frozen-global
missing-dist prerequisite failure is not repeated or retroactively greened.
This task adds no full/global gate. Built emit and actual public resolution are
mandatory prerequisites for its consumer proof.

Host command-budget witnesses reach tick(first) before typed maxCommands failure;
no missing-command diagnostic overflow is an accounting oracle. Cancellation
must retain the exact supplied FsError and observe late rejection. Input default,
explicit-empty and binary variants traverse env/transparent invoke/pipeline/cat
with exact sink environment and original provenance. No new output accounting
policy, lifecycle API, firstread closure, bash-c parameter-status fix, ERR trap,
inherit_errexit, creation mask, native-env-order or full GNU parity claim.

## Primary protocol sources

GNU Coreutils manual23.2, version9.11 search snapshot accessed August27,2026:
`https://www.gnu.org/s/coreutils/manual/html_node/env-invocation.html`.
Official HTML alias search snapshot still identifies9.9; the executable used
here is independently verified9.7, not claimed9.11. The protocol references cover
quote grouping, supported escapes, comments, braced variable expansion before
environment changes and literal optional shebang arguments. Primary9.7 source
is also locally available beside the pinned oracle at coreutils-9.7/src/env.c;
its bytes are hashed in preparation. No secondary blog oracle.
