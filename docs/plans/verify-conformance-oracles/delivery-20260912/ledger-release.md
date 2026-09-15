

## verify-conformance-oracles — verified implementation publication, 2026-09-12

**Local implementation commit:** `d5baada123a54174cfa6a31f65427d160d1c4ccb` (`fix(safe-js): reject incomplete conformance oracle reports`). **Remote main:** independently read back at that exact SHA after the normal push; subsequent fetch/ancestry check passed. **Root release tag:** `v15.0.27` resolves to the same implementation SHA. [Local commit/preservation receipt](verify-conformance-oracles/delivery-20260912/local-commit.json), [remote receipt](verify-conformance-oracles/delivery-20260912/remote-main.json), [complete publication receipt](verify-conformance-oracles/delivery-20260912/publication-receipt.json). No associated GitHub issue number was supplied, so no issue closure was performed.

All required implementation workflows completed successfully on that exact source:

| Workflow | Result | Receipt |
| --- | --- | --- |
| [Release](https://github.com/poe-platform/poe-code/actions/runs/34710249835) | success, including uncached unit/native gate and publication | [Job/step results](verify-conformance-oracles/delivery-20260912/root-workflow.json), [complete compressed log](verify-conformance-oracles/delivery-20260912/root-release.log.gz) |
| [Release scoped safe packages](https://github.com/poe-platform/poe-code/actions/runs/34710249647) | success, including installed-tarball checks and all three publishes | [Job/step results](verify-conformance-oracles/delivery-20260912/scoped-workflow.json), [log](verify-conformance-oracles/delivery-20260912/scoped-release.log) |
| [Publish Schemas to GitHub Pages](https://github.com/poe-platform/poe-code/actions/runs/34710249608) | success | [Job/step results](verify-conformance-oracles/delivery-20260912/schema-workflow.json) |

The clean committed SafeJS package unit task ran its maintained native pretest and reported **29,072 passed, zero failed, 47 skipped; 1,308 passing and two skipped files**. The 47 skips remain nonpasses; the case ledger above retains their explicit unavailable/optional/reference-gap dispositions. This successful clean-source CI gate does not repair or erase the preserved dirty-workspace exploratory native-Promise symbol-admission test and its explicitly owned host-capability gap. No full current-source Test262 semantic pass is claimed. The focused local oracle suite remains 212 passing tests with zero skips; historical complete-corpus accounting remains 102,926 variants exactly once, with its failures and unsupported outcomes retained.

### Actual published packages and independent artifact checks

| Package | Published version | Publication source | Independent installed smoke |
| --- | --- | --- | --- |
| `@poe-platform/safe-fs` | **0.1.562** | `d5baada123a54174cfa6a31f65427d160d1c4ccb` | Explicit memory filesystem byte write/read passed |
| `@poe-platform/safe-js` | **0.1.562** | same SHA | Arithmetic returned 42; ambient `process` remained absent |
| `@poe-platform/safe-bash` | **0.1.562** | same SHA | Unregistered command rejected; explicitly registered `printf` passed with memory filesystem |
| `poe-code` | **15.0.27** | same SHA; npm `gitHead` and release tag also match | CLI rendered exact installed version; published `poe-code/safe-js` export passed arithmetic and absent-process controls |

[Final registry metadata](verify-conformance-oracles/delivery-20260912/registry-final.json) independently verifies all four `latest` versions, exact tarball SHA-512 against downloaded bytes, attestation subject digests, signed source SHA and publishing invocation URLs. Scoped packages omit npm `gitHead`; their recorded SLSA resolved dependency supplies the publication commit. Full npm attestation bundles are retained beside these receipts. No source ancestry was inferred from workflow names or assumed from a successor.

Fresh consumer installation used exact registry versions, `--ignore-scripts --no-audit --no-fund`, and no workspace links. [Installed versions](verify-conformance-oracles/delivery-20260912/all-installed.json) confirm all four packages. `npm audit signatures` exited **0**: **213 registry signatures and 42 available attestations verified**, including the four package attestations independently inspected above. [Signature log](verify-conformance-oracles/delivery-20260912/all-signatures.log), [manual procedure](verify-conformance-oracles/delivery-20260912/artifact-qa.md), [SafeJS smoke](verify-conformance-oracles/delivery-20260912/safe-js-smoke.json), [Safe Bash smoke](verify-conformance-oracles/delivery-20260912/safe-bash-smoke.json), [SafeFS smoke](verify-conformance-oracles/delivery-20260912/partial-smoke.json), [root smoke](verify-conformance-oracles/delivery-20260912/poe-code-smoke.json). The conformance runner is a repository test tool; these publications do not claim that its test files are bundled into npm runtime artifacts.

Operational failures and corrections remain explicit:

- SafeJS metadata initially returned the old latest version and then HTTP 404 for the new exact version while npm processed publication. SafeFS and Safe Bash were verified independently during that partial propagation. A subsequent exact-version read, fresh tarball/attestation checks and final latest read verified SafeJS 0.1.562. The initial observations were not counted as success; [propagation receipt](verify-conformance-oracles/delivery-20260912/registry-propagation-observation.json) and original `scoped-registry.json` retain them. No publication was retried locally.
- The first ad hoc Bash smoke omitted command registration and returned 127 as designed. The corrected check explicitly rejects that unregistered case and then registers only `printf`; no product defect or runtime repair was invented. The initial failed assertion and corrected result are both retained.
- The CLI command exited 0 and displayed 15.0.27, but an initial ad hoc postcondition expected undecorated stdout. Current `version.ts` deliberately uses the design-system frame. [Exact version verification](verify-conformance-oracles/delivery-20260912/poe-code-version-verification.json) matches the rendered value to installed/registry metadata and rejects the previous-version counterexample. No product assertion, budget or timeout changed.
- A broad staged whitespace check found original terminal-log blank lines at EOF. Raw evidence bytes were retained; source, Markdown and JSON whitespace checks passed separately. [Receipt](verify-conformance-oracles/delivery-20260912/raw-log-whitespace-check.json). This was not a unit-test failure.

**Disposition:** oracle/accounting acceptance and implementation publication are verified. Historical semantic/resource failures, unsupported adapters, and the separately tracked native-Promise host-admission gap remain honest, owned nonclaims. No implementation release or package propagation blocker remains.

This evidence-only follow-up records the already verified implementation publication. Its own normal push and required CI will also be monitored. It changes only task evidence, so a successful no-release outcome is expected rather than another claimed version. Its SHA and subsequent workflow outcome must be recorded after creation; a commit cannot contain its own SHA or a future workflow result.
