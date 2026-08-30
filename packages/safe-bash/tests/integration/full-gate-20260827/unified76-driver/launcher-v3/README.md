# Unified76 launcher v3 — author packet, not release acceptance

The entry is `run.mjs`. Importing it or `worker.mjs` is inert, including with
spoofed `process.argv`. Actual execution requires **`--run`**, an exact candidate,
an explicit matching root-release receipt and `--committed-archive`.
`--execute` is rejected. There is no ambient auto-run or full-gate authorization
in this packet. Dirac's independent A01–A22 remain a separate review.

## Immutable product and fixture amendment

- Product candidate: `f5e9fc49b6abb38e180cc9de16c95fced102ff75`.
- Parent: `44f00bf84278e3361b52106478d59c707ab7b2bc`.
- Tree: `5687cbdebc46ec6d3618d32072c4de708118b9bb`.
- Unchanged production source tree: `5876c6bf4ad9bc07f22cc46f8dbee99461981862`.
- Reachable four-file fixture source: `284a4c5a193e2001c373fd35806e920bf3ffb90f`.
- Actual rebuilt full tarball, twice:
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
- Package manifest, a different artifact:
  `513f26e135e7f499b8fb92b7981b2e82a2e91d512db88518f48daf81c1bbf74a`.

`CANDIDATE.json` stores the raw commit body, its SHA256, all four before/after
Git blobs and exact literal replacements. `../amendment-v3/driver/reconstruct.mjs`
reconstructs the exact commit/tree in two fresh object databases, one with a
space-containing path, using reachable base/fixture objects. No private ref or
surviving loose candidate object is the durability mechanism.

The complete amendment was frozen before editing. Relative to2ffcb23d only the
inspection title, unique-name assertion and suffix change:76,76 and addition of
HTML/DU/expr. Both custom registry assertions remain77. The original four-file
scope remains split, stream-format contracts, stream-inspection public tests and
the maintained stream-five consumer. No fifth fixture or production file changes.

The first fresh proof rebuilt c109 and executed split7, inspection21 and
stream-five21 successfully. The format file failed to load because the author
selection omitted its existing `stream-format/helpers.ts`; its19 bodies did not
execute. This **49 pass/1 launch failure** is retained. A fresh selection with
that unchanged candidate helper then executed the remaining19/19 bodies and
rebuilt the same c109. Thus all four affected bodies were exercised, but this is
not relabeled as one uninterrupted68/68 run. Original07047's67/1 and2ffcb23d's
20/1, including its unreached suffix assertion, remain unchanged historical data.

## Exact input, tool and OS boundaries

The profile lists632 canonical test paths,192 classified `.mts` paths and256
cleanup inputs. Complete committed-tree materialization is an explicitly
conservative runtime-input superset:37,397 blobs,2,382,440,321 bytes. It is not
the compact typing selection. Git blobs stream directly into prevalidated
paths; no tar header can select an output path, and symlink ancestors, escapes,
duplicate paths, unknown modes, missing objects and content/hash mismatches fail.
The isolated repository also receives bounded reachable Git history.

`EXTERNAL-RECEIPT.json` binds the earlier external observation without rewriting
its historical incomplete status. Actual admission rechecks61 readable file
identities, including data assets—not61 executable commands—and the complete
declared main/benchmark/npm/Git-helper trees. Native49+2 assessment is hash/mode
identity admission, not semantic oracle success. Ambient Node/DYLD/LD/Git
injection is rejected; controlled Git transport disables global/system config
and replacement-object interpretation. The launcher and selected worker use
pinned Node24.11.1; this does not raise the product's Node>=22 minimum.

Root's trusted macOS26.4.1/build25E253 boundary is **exactly the eleven sampled
tool/reference pairs** in `SYSTEM_REFERENCES`. Their original locations and
`sw_vers`/`otool` observations are retained. They lack readable files: there is
no file hash, full OS attestation or complete dynamic-image enumeration claim.
A new readable library, different OS build, extra/unknown sampled image,
Homebrew/npm/user library or unexpected access error cannot inherit that
exception. Other readable tools/dependencies remain hash-bound. Native children
and explicitly different test-owned environments are not claimed to inherit a
universal OS-level execution sandbox or complete worker-thread loader trace.

## Integrated execution policy

`execute.mjs` connects admission, bounded materialization/history transfer,
runtime/permission probes, typing, canonical discovery, maintained consumers,
pack/move, public types/negative controls and final inventories. It is no longer
the earlier policy-functions-only prototype. The full product gate itself has
not been executed by this author packet.

- One driver-managed production build, inside `typecheck:all`, is authenticated
  and reused by the versioned external maintained-consumer verifier. No second
  driver build is renamed preflight. Test-owned isolated builds remain distinct.
- The original candidate inventory validator and selection are executed before
  reuse:192 roles and580 selected consumer test-file bindings. Current provider
  bytes remain authoritative; the old informational provider digest is retained.
  Noncurrent hashes, nested evidence and unknown-path rejection remain enforced.
- Consumer config, runtime/type bodies, mandatory TAP counts, permission flags,
  exact diagnostics and source-denial controls are unchanged. The external
  verifier replaces only the cold/build seam and binds its five imports to the
  frozen source. Its generated entry and approved build/input receipts are hashed.
- Canonical execution is explicit TAP, concurrency2 and the exact632 paths.
  Large TAP output is streamed with bounded lines/cases. Secondary diagnostic
  text inputs are bounded to8MiB rather than increasing an unbounded buffer.
- Persistent source/artifact additions, removals, content/mode/type/link changes
  fail. The inventory is frozen after authorized setup; only a new `dist` tree is
  admitted across the production build. This is not a claim to detect every
  transient same-byte write attempt.
- Actual SafeJS, if available at execution, uses regular-file copies and private
  HEAD/status/index/copied-file guards. No private build/install/source edits are
  authorized. Missing prerequisites refuse; actual test skips remain non-green.

Finite bounds:3GiB blob-transfer bytes,8GiB history transfer,1GiB per declared
dependency tree,1MiB setup stderr,256MiB per phase output,4GiB total phase output,
1MiB TAP lines/details and100,000 TAP cases. Setup is externally supervised with
a600-second deadline before the first phase; each phase is capped at1800 seconds.
The outer total limit is600+14×1800+5 seconds. Cleanup checks are bounded; forced
termination, observation failure or surviving descendants yields HOLD/nonzero,
not a success with abandoned resources. Outputs and temporary proof directories
are retained for inspection rather than broadly deleting other workers' state.

Green requires all ordered phases, exact expected negative-control exits,
complete source/tool/package bindings and final guards, one production build,
natural cleanup, reconciled canonical coverage and **zero fail/skip/TODO/cancel**.
Qualified red measurement is still nonzero. A successful TAP footer cannot
override missing bindings, a missing inner report or outer cleanup failure.

## Commands and review status

Use pinned Node24 and supply the authenticated RG/TREE paths from the external
receipt. Remove ambient `GIT_PAGER` explicitly; do not weaken the injection guard.

```text
env -u GIT_PAGER RG_NATIVE_BIN=... TREE_NATIVE_BIN=... /Users/kjopek/.nvm/versions/node/v24.11.1/bin/node tests/integration/full-gate-20260827/unified76-driver/launcher-v3/run.mjs --candidate f5e9fc49b6abb38e180cc9de16c95fced102ff75 --inspect
```

After independent review and root release only, replace `--inspect` with
`--run /tmp/full-gate-unified76-UNIQUE --release /absolute/ROOT-RECEIPT.json
--committed-archive`. The receipt must match candidate, driver, profile and
package, and explicitly affirm public74/75/76 plus independent driver acceptance.
No such release is created here.

The final bounded author controls include actual small Git blob/history
transports, process cleanup/deadline enforcement, real launcher inspection and
unreleased-run refusal, generated consumer-entry execution, inventory routing,
mutation negatives and streaming TAP comparison. They do not execute the full
2.382GB transport or the complete canonical/current-consumer gate. Independent
review must assess those execution bindings; no full-gate or service acceptance
is inferred. WHICH77 `284857d7…` and its49191d09… package remain unchanged.
