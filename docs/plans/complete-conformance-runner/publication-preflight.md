# Publication preflight

Read-only inspection on 2026-09-12, registry observations at `2026-09-12T13:16:03Z` and digest cross-check at `13:16:19Z`. Working source advanced to local `a4476e3fabf1bf5f3c492aa76f38ff0bf3d05e46` during the independently owned delivery process. This document is a preflight, not a receipt that this change was published.

The repository reference `NPM_PUBLISHING.md` resolves to [docs/development/NPM_PUBLISHING.md](../../development/NPM_PUBLISHING.md), not a root file. No local publication, dispatch, registry mutation, installation or duplicate expensive test was performed.

## Required publication surfaces

| Workflow | GitHub workflow ID | Required output |
| --- | --- | --- |
| `.github/workflows/release.yml`, Release | 201811052 | `poe-code@latest`, including bundled `poe-code/safejs` and compatibility surfaces |
| `.github/workflows/release-validation.yml`, Release validation | 350325358 | Reusable parent Release gate: build, packed CLI smoke/package lint, audit/stress, fresh and cached unit checks, four Bash shards |
| `.github/workflows/release-safe.yml`, Release scoped safe packages | 347924818 | `@poe-platform/safe-fs`, `@poe-platform/safe-js`, `@poe-platform/safe-bash`, in that order |

All IDs were verified active using `gh workflow list --all --json id,name,path,state`. SafeJS source paths trigger the scoped workflow. It publishes all three generated public artifacts with one shared next patch version, computed from the largest actual registry version. The private names `@poe-code/safe-js`, `@poe-code/safe-fs` and `virtual-bash` are not publication targets. Both public SafeJS and Safe Bash depend on the matching public SafeFS version. A later partial publication can therefore raise the next shared version even when not all prior artifacts published.

Root semantic-release publishes fixes, features, performance and refactors as patch releases under the current rules; docs/chore/test-only commits do not themselves require a version. Because the ISO repair is a runtime fix, its delivery requires actual root and scoped publication, not a docs-only green-run explanation.

The scoped workflow requires full build, package-safe tests, package lint, and installed generated-tarball smoke on Node and Bun before publication, plus declaration compilation, browser bundle smoke, old-root coexistence and SafeFS-only smoke. Trusted publication uses Node 22, npm >=11.5.1, OIDC and `--provenance`. The root Release consumes a same-run SHA-256-verified build only after reusable validation succeeds.

## Actual registry baseline

All four provenance statements identify source commit `16fd655592118dbac4cf6764b8a2f3c8f6138786`, repository `https://github.com/poe-platform/poe-code`, ref `refs/heads/main`. Scoped packages identify `release-safe.yml`; root identifies `release.yml`. Scoped `gitHead` is absent, so attestation `buildDefinition.resolvedDependencies[].digest.gitCommit` is essential. Root `gitHead` matches that same commit.

| Package | Actual latest | Registry SHA-512 integrity |
| --- | --- | --- |
| `@poe-platform/safe-fs` | `0.1.560` | `sha512-9BZJV7Imza9S5kU7cABD9JAJYlUlm/HhHj//fJzcBba+rDIDh1tU8S3vc+q4iuLBPfcSi827xuv7n8+P9t8vMA==` |
| `@poe-platform/safe-js` | `0.1.560` | `sha512-Z+d7Gb6uNCMNqel2e/5irWYZwcTIkvH+kGw1f8CoTx/4nMXlKENWag05H3jBbwKApNSwACZelQdJmIL7hPQqRg==` |
| `@poe-platform/safe-bash` | `0.1.560` | `sha512-GtR4bC83+dOwoSPB7kPBVQ/J2iBGDPcoCrN+zsSFv0PEtx1FvNmYrkCcHUpVsi90dBeO0ilBN17k1467wNZrBQ==` |
| `poe-code` | `15.0.25` | `sha512-sIoYUHDzV/DPsUCafVqTmw5WzZrYxwy9MUUhkJR3VbZWbkDHaCdpL0l8ERhA5n1XcEka+/drYTWGMByQfNQcBA==` |

For every package, fetched registry `/latest`, followed `dist.attestations.url`, decoded the SLSA DSSE payload and verified its sole subject SHA-512 equals the base64-decoded registry `dist.integrity`. All four comparisons passed. Registry signatures and SLSA provenance were present. This metadata consistency check does not claim cryptographic Sigstore verification, actual downloaded-tarball hashing or installed-artifact execution; those remain final delivery requirements.

Matching successful historical runs: [scoped publication 34663522111](https://github.com/poe-platform/poe-code/actions/runs/34663522111) and [root publication 34663522352](https://github.com/poe-platform/poe-code/actions/runs/34663522352). Later root run [34670859477](https://github.com/poe-platform/poe-code/actions/runs/34670859477) was green at source `d72160a500ef9ac63961eb8af264272a39ec96f9`, while registry latest remained 15.0.25. Thus the newest green run alone does not identify a new publication.

## Delivery checklist and recovery

1. Record actual local SHA and prove it is an ancestor of fetched remote main. Track both required publishing workflows at that SHA; a successor must independently contain the fix. Cancelled/superseded runs are not success.
2. Observe every required validation/publication job to completion. Record run URLs, conclusions and actual versions emitted by the publishing jobs separately from local and remote commit receipts.
3. Query all four exact versions independently, retrying registry or attestation propagation. Do not infer scoped publication from root or one scoped sibling. Verify matched SafeFS dependency versions and package repository/workflow/source ancestry in each SLSA statement.
4. Download each exact published tarball, verify its SHA-512 against registry integrity and provenance subject, and verify registry signatures/provenance through available tooling such as `npm audit signatures` in the installed consumer. Record any unavailable or unsuccessful cryptographic check honestly.
5. Install exact public versions with lifecycle scripts disabled into isolated consumers. Execute the published scoped smoke surface, SafeFS-only control, and root `poe-code/safejs` separately. Run the ISO standalone long-month and range regression through both installed SafeJS surfaces; verify the installed files contain the committed adapter rather than resolving workspace source. Keep published Node/Bun or other runtime claims scoped to what actually ran.
6. If a subset publishes before failure, preserve successful immutable versions and independently verify them. Repair a validated failing build with tests and a separate atomic commit, then follow a GitHub successor containing that repair. The workflow's max-registry-plus-patch computation can recover shared alignment. Never republish an immutable version, locally publish, unpublish or destructively roll back. Pending package or attestation availability remains unresolved until verified; use direct registry reads or GitHub logs as alternate read-only evidence when API limits intervene.

Reproduction commands used: `gh workflow list --all --json id,name,path,state`; `gh run list --workflow release.yml --limit 3 --json databaseId,headSha,status,conclusion,url`; same for `release-safe.yml`; GET `https://registry.npmjs.org/<encoded-package>/latest` and the returned attestation URL. No new version is promised from the baseline: concurrent releases can change the next patch before the task publishes.
