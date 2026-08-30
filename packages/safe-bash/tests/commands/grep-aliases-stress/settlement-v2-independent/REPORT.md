# Independent alias settlement-v2 review

## Verdict — August 27, 2026

**Scoped ACCEPT** of preparation `8b89c0e76dfe581ce57418b391e74ce299686af7` and author evidence `b6987ae7e6348ffb3deeacdade033ec281849aa7`. Actual independent replay: **77/77 base + 5/5 supplement**, zero failed product subcases. This accepts the two-case fixture correction, not a new source fix, universal grep parity, public alias export, or default registration. **Root integration remains HOLD until explicit root authorization.**

The independently authored review harness was committed as `643439ad` before execution. It authenticated all 26 author files against the evidence commit before and after execution, reversed the exact two hunks, inspected the disclosed capture collision, executed additional exact-body assertion controls, then ran the unchanged, authenticated author replay. Result inspection independently checks the raw subcases, retained direct-handler boundaries, strict compilation receipts, worker retirement, path bindings and inventories.

## Accepted and rejected boundaries

- **S07**, `borrowed-external-Shell-stdin-return-rejection-not-waived`, and **ROOT-CONTROL**, `public-registered-grep-reproduces-external-return-failure`, now require public `Shell.exec` rejection with the **identical supplied return sentinel**, no fulfilled result, and exactly one producer return. S07's observed next count is one; ROOT-CONTROL confirms aliases are not registered.
- At frozen source `0123c83d`, `src/shell/shell.ts:172` awaits external stdin closure after successful command execution and propagates its failure before constructing a `ShellResult`. `src/shell/input.ts:61` preserves that exact close reason when there was no earlier read failure. This is not a fulfilled status-2 handler result and does not expose returned stdout/stderr/status to invent.
- This is distinct from the already reviewed **primary read failure** fixtures: the primary failure there remains status1 plus its diagnostic and must not be replaced by a secondary return error. No conflict or new general error-precedence policy is introduced.
- The **four direct egrep/fgrep return-throw/reject cases still return status2**, with their unchanged diagnostics. The owned-VFS return-failure case still returns status2 and `fgrep: owned-file-return-sentinel\n`. Registered cleanup/abort precedence, byte/VFS effects and other assertions remain intact.
- Only the two try/finally spans change. Reverse application reproduces the complete original fixture; masking those spans yields the same remainder hash. All other **75 base plus five supplemental cases** retain their original inputs/assertions. No weakened regex limit, deadline, source guard, cleanup rule or output oracle is accepted.

## Actual replay and controls

| Separately counted cohort | Independent result |
| --- | --- |
| V2 base product subcases | 77 pass / 0 fail |
| Unchanged supplemental subcases | 5 pass / 0 fail |
| Strict moved-package consumer compilations | 2/2 |
| Replayed author exact-body controls | 8 negative rejections + 2 positive acceptances |
| Additional reviewer exact-body controls | 14 negative rejections + 2 positive acceptances |
| Actual workers | 91 created / 91 exited; zero active or verifier-forced termination |

The reviewer controls exercise both exact patched bodies with fulfilled status0/status2/undefined, rejected zero, equal-message distinct Error, and zero/two producer-return counts. Every negative raises `ERR_ASSERTION`; exact sentinel + one return passes. Each execution invokes exec and finally disposal exactly once. These are **stub-settlement assertion controls, zero product passes and zero source mutants**.

The one base run and one supplemental run completed without product retry. Review interval: **2026-08-27 17:03:22.080–17:04:50.918 UTC**, Node **22.22.2**, Darwin arm64. Both strict consumer compilations use authenticated retained development tools; no install, product rebuild, repack, private checkout access or live product overlay occurred. Zero late errors or forced cleanup were recorded. Current unrelated regex edits were never candidate inputs.

## Freeze and binding receipt

| Identity | Value |
| --- | --- |
| Frozen source candidate | `0123c83d3aae72a15621acbb29a165b97b2c6ab6` |
| Candidate archive SHA-256 | `64fac38e43ce89009e03d24b8b3dffb8425dd98a313bea4d4133d6db8030cccf` |
| Unchanged npm tarball SHA-256 | `62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6` |
| Actual worker SHA-256 | `bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7` |
| Original fixture SHA-256 | `d454002f97fa37b6546bad238feec5472774646a6bf0d766fea32c2c0c32977b` |
| Derived fixture SHA-256 | `41fb87e021e9d851905e889e26beaad4a779336b787e665b21c76bbace5f8850` |
| Unchanged remainder SHA-256 | `f034cbd3570f36d1dc968123d5c3f8bafc72cab73687bc31ed67b85de7e9e9d5` |
| Node binary SHA-256 | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |

All **27,687 committed Git entries** authenticate, including data symlink targets without traversal. The full built source/tools inventory has 30,613 entries; the moved package has 776 entries / 738 regular files / zero symlinks. Membership and byte hashes before/after include new-entry detection, not just hashes of original paths. These inventories do not monitor identical-byte write attempts or establish a hostile-host sandbox.

The exact retained tarball is extracted and physically moved into a new consumer. Execution resolves public root `Shell` and the packed **internal alias module**, not an unimplemented public subpath. Actual worker URLs all point to that authenticated moved package. This evidence does not claim complete transitive main-thread import tracing. The prior read-only package/source/dependencies and historical seals remain unchanged. Only this review's owned consumer/cache resources were removed after capture.

## Collision, history and profile qualification

The author first wrote control rows and a supervisor receipt to the same `assertion-controls.json` name. The first raw rows were lost; only the successful process receipt is preserved. The second explicit control capture retains its rows. Independent byte comparison confirms the only replay-script repair is the distinct `assertion-control-results.json` output name. **No product retry or overwrite is attributed to this capture correction.** Our single replay uses the corrected distinct names and preserves both files.

The historical **154a8d22 80/82** result remains immutable and is not rescored or called green. The whole original fixture and old results are retained. Current fixture-v2 acceptance does not rewrite that history.

Native/profile comparisons retain historical Darwin C-locale observations: **BSD raw exact16/26; GNU raw exact0/26; GNU stdout/status/VFS projection26/26**. Warnings remain raw, and the projection excludes stderr—it is not full parity. No native oracle was executed anew and no GNU/Linux claim is made. This alias review is not the separate frozen8670 package cohort or whole-product gate.

## Reproduction and immutable capture

Executed once, with a unique isolated destination and preserved prior artifact prerequisite:

```sh
SAFE_BASH_APPLY_PATCH="$(command -v apply_patch)" /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/commands/grep-aliases-stress/settlement-v2-independent/review.mjs /tmp/alias-settlement-v2-independent-curie-01
node tests/commands/grep-aliases-stress/settlement-v2-independent/inspect-results.mjs /tmp/alias-settlement-v2-independent-curie-01
```

New executions require new destinations; never overwrite the recorded run. These version-bound audit drivers are explicit opt-in, not canonical discovery. `CAPTURE.json` authenticates the compressed raw capture; `RAW-MANIFEST.json` enumerates its bytes. Verify without product execution:

```sh
node tests/commands/grep-aliases-stress/settlement-v2-independent/verify-capture.mjs
```

No production, root export, manifest, author fixture or original evidence was modified. The earlier shared-input v2 acceptance `18c02655` remains separate; root decides the subsequent 70→73 wiring.
