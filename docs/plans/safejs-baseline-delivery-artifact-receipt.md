# Baseline delivery artifact receipt — 2026-09-12

This is fresh installed-artifact evidence for already published packages, separate from local maintained-source tests and delivery of the documentation. No package was published locally. Source under reconciliation is `7654048d6eb593530e126ddc51df58f26cb384cd`; the three scoped artifacts came from `16fd655592118dbac4cf6764b8a2f3c8f6138786`, not that documentation merge.

## Manual artifact QA and outcomes

Executed from the isolated delivery checkout, Node **22.23.2**, ICU **78.2**, Unicode **17.0**, macOS arm64. Bun is **1.3.11**. Commands and terminal outcomes:

1. `npm install --prefix docs/plans/safejs-baseline-delivery-artifacts --ignore-scripts --no-audit --no-fund @poe-platform/safe-js@0.1.560 @poe-platform/safe-fs@0.1.560 @poe-platform/safe-bash@0.1.560` — exit **0**, fresh consumer installation. Installed artifacts and copies of maintained fixtures stay local; none is adopted as shipped test code.
2. From that consumer directory, `cp ../../../scripts/fixtures/safe-packages-*.mjs .` then `node safe-packages-smoke.mjs` — exit **0**. An initial copy used the repository-relative path from the consumer directory and exited **1** (`zsh: no matches found`); no smoke ran in that failed setup attempt. Correcting the working-directory-relative path produced the actual successful invocation.
3. From the same consumer, `bun safe-packages-smoke.mjs` — exit **0**. Both smoke commands execute the maintained published-package checks, including independent SafeJS guest evaluation/realm/replay, filesystem identity/operations, and Safe Bash shell checks. Their common terminal receipt is `Scoped SafeJS, shell, canonical filesystem, copy options and input limits passed`; all subsequently imported line-ending/LLM-command checks also terminate successfully. This is maintained installed-artifact smoke, not full conformance/runtime-matrix qualification.
4. `npm audit signatures --prefix docs/plans/safejs-baseline-delivery-artifacts` — exit **0**: **18 packages have verified registry signatures; 12 packages have verified attestations**. This strengthens the older observation that only decoded, unverified provenance had been inspected.
5. Fetch each exact latest manifest from `https://registry.npmjs.org/<package>/latest`, fetch its `dist.attestations.url`, decode the DSSE payload, and fetch `dist.tarball`. Compute SHA-1 and SHA-512 of the downloaded bytes; compare SHA-1 to `dist.shasum`, base64 SHA-512 to `dist.integrity`, and hexadecimal SHA-512 to every attestation subject. All **four packages match all three comparisons**. The umbrella tarball was independently integrity-checked but not freshly installed in this receipt; its previously recorded artifact controls remain historical.

## Registry and provenance observations

| Package                 | Version | Node engine | Tarball bytes | SHA-1                                      | Publication source / workflow                                                                                                    |
| ----------------------- | ------- | ----------- | ------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| @poe-platform/safe-js   | 0.1.560 | >=18.18     | 8,496,924     | `279bb7ca56911a3ba4e4ac733da48cab085bd76f` | `16fd655592118dbac4cf6764b8a2f3c8f6138786` / [run](https://github.com/poe-platform/poe-code/actions/runs/34663522111/attempts/1) |
| @poe-platform/safe-fs   | 0.1.560 | >=18.18     | 141,456       | `94a25a32ebb215d1ce1e0ccba7b00b35494e6826` | `16fd655592118dbac4cf6764b8a2f3c8f6138786` / [run](https://github.com/poe-platform/poe-code/actions/runs/34663522111/attempts/1) |
| @poe-platform/safe-bash | 0.1.560 | >=22        | 4,463,602     | `628c61477bf0df03f99f4feaef9d44bb0bc2e316` | `16fd655592118dbac4cf6764b8a2f3c8f6138786` / [run](https://github.com/poe-platform/poe-code/actions/runs/34663522111/attempts/1) |
| poe-code                | 15.0.24 | >=18.18     | 34,048,080    | `722194ab3adc8a6c98059e76c623c135aef3fc8a` | `79999cba7bb7bae0581a7a1ba035c4abed6f0397` / [run](https://github.com/poe-platform/poe-code/actions/runs/34649408167/attempts/1) |

All three scoped artifacts use `.github/workflows/release-safe.yml` and omit manifest `gitHead`; verified provenance supplies source attribution. `poe-code@15.0.24` uses `.github/workflows/release.yml`; its manifest gitHead agrees with its provenance. Scoped source `16fd655...` is an ancestor of the reconciliation, but these artifacts do **not** contain the baseline ledger. At this observation, root workflow [34663522352](https://github.com/poe-platform/poe-code/actions/runs/34663522352) for `16fd655...` was still running; publication cannot be inferred from its green build alone.

Optional local raw receipts below are fingerprinted observations, not required committed dependencies. This document retains the exact commands, terminal outcomes and source attribution independently of them.

| Local raw receipt        | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `install.log`            | `8a943c447f62a5c4c0cae11ead788c17507aff5532d381380afd16ae076a5dbc` |
| `smoke-node.log`         | `ae228aea406632c27835d934c6699e1ef765cd8f3a5d217e2183dbd9ab6fbe94` |
| `smoke-bun.log`          | `8d7d6bc784c95b5a4c445b20f0747dc77c7daccc8836a3e866b072175e915477` |
| `signatures.log`         | `598dcadda1e8463223ac730832a127db349e786b60aa1af2406df2f55bda94f4` |
| `registry-initial.json`  | `0c2e3ae2d20082e93adc97318b761e4ead92b6566c8bab074e367032f3ef7aa8` |
| `tarball-integrity.json` | `21158ba154005c39b0658c3b98014a0bffecec87dd17901b42f02186824441ab` |

## Predecessor umbrella publication completed during this execution

[Root release 34663522352](https://github.com/poe-platform/poe-code/actions/runs/34663522352), source `16fd655592118dbac4cf6764b8a2f3c8f6138786`, completed **success**. Its semantic-release log reports publication of **poe-code@15.0.25** to `latest` at **2026-09-12 01:38:47 UTC**, and terminal release success at 01:38:49 UTC. All required validation jobs succeeded. This supersedes the initial in-progress root observation above; it is publication of the concurrent source, not publication of the baseline ledger.

At 01:39:50 UTC, exact-version npm metadata and freshly decoded provenance agree on `15.0.25`, source `16fd655...`, `.github/workflows/release.yml`, invocation `34663522352/attempts/1`. The first two ordinary `npm install ... poe-code@15.0.25` attempts and one direct tarball fetch returned **404** while the manifest was already visible. These failures remain registry propagation observations, not successful installations. A read-only request to the same published tarball with query `?baseline=20260912` returned bytes immediately; the query only bypasses the stale cache.

Downloaded **34,288,311 bytes**, SHA-1 `9b99a5cf88730126d25b185a7eed355d5364f3cb`, integrity `sha512-sIoYUHDzV/DPsUCafVqTmw5WzZrYxwy9MUUhkJR3VbZWbkDHaCdpL0l8ERhA5n1XcEka+/drYTWGMByQfNQcBA==`. Independently computed SHA-1 and SHA-512 match the registry manifest and every attestation subject. Installing that verified downloaded tarball with `npm install --ignore-scripts --no-audit --no-fund ./poe-code-15.0.25.tgz` in the consumer exited **0**. No publication, rollback or repository package-manifest mutation occurred.

From that consumer, `node safe-packages-legacy.mjs` exited **0**, retaining canonical filesystem-error normalization across the umbrella/scoped entrypoints. The following manual installed-artifact probe also exited **0** on Node22.23.2/ICU78.2:

```js
import assert from "node:assert/strict";
import { run, Budget } from "poe-code/safe-js";
const result = await run("return values.map(value => value * 2);", {
  bindings: { values: [2, 3] },
  budget: new Budget({ maxSteps: 1000 })
});
assert.equal(result.ok, true);
assert.deepEqual(result.returnValue, [4, 6]);
const authority = await run("return [typeof process, typeof require, typeof fetch];");
assert.equal(authority.ok, true);
assert.deepEqual(authority.returnValue, ["undefined", "undefined", "undefined"]);
```

Final `npm audit signatures` in this consumer exited **0**: **212 packages have verified registry signatures; 41 packages have verified attestations**. The three scoped versions remain independently verified `0.1.560`. These bounded installed controls are not a full runtime or Test262 qualification and do not erase the separately reproduced ISO, Promise-admission or Temporal-extension gaps.
