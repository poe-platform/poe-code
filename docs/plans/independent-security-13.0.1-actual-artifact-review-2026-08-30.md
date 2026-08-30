# Independent security 13.0.1 actual-artifact review

Date: 2026-08-30
Role: independent actual-artifact validator
Decision: **SCOPEDPASS**

## Decision and publication scope

The already-published `poe-code@13.0.1` artifact passes the bounded actual-artifact checks authorized for the partial dependency-security remediation. The approved later docs publication scope is this report only. This decision does not republish or alter the five security source files already present in release commit `a709a292997bc167d594a736391df64e3a432c68`, and it does not approve publication from this validator workspace.

This is a qualified partial-remediation result: the historical source audit changed from 31 to 3 unique GHSA identifiers (28 removed, none added, 25 lock records changed), while three advisories remain held. It is not an all-advisories-clear result and is not a claim that every removed advisory received an exploit test.

## Actual release binding

- Publisher receipt identifies version `13.0.1`, git head/tag commit `a709a292997bc167d594a736391df64e3a432c68`, successful package publication, and successful release/Pages/Toolcraft publisher gates. Those CI results are publisher/root evidence and were not independently rerun here.
- The independently captured registry query and fetch exited `0/0`. Their metadata binds the artifact to SHA-256 `8cce2cd44f4f5a10d01fd1b35c78789d187507364d6029066b3319ccf17d9714`, SHA-1 `1748cda1deede5991dba985bbc1acc1b3a54a072`, and SRI `sha512-XremI54ZaLoY2cXshTlMtF0MDM0gDO0w9lJFrWn8K2qUTOFj5yvlShTrouzOi+g22xOEda4eShj8MZNLpafOIw==`.
- The retained tar is `/tmp/poe-actual-release.4DxH6G/download/poe-code.tgz` (16,456,922 bytes). It was only statted during this adjudication; the verified capture hashes and lockfile integrity provide the binding.
- The first tar-metadata capture exited 1 because it assumed the source-only private package manifest would be present. The corrected metadata capture confirms that absence is expected: release packaging includes `packages/poe-agent/dist`, not its private `package.json`; source proof retains its `shell-quote` floor `^1.9.0`.

## Finite actual continuation

The seven raw captures (`tar-metadata`, `install-seeds`, `install-tar`, `installed-metadata`, `probe-copy`, `probe-node22`, and `probe-node18`) each show return code 0, `reaped: true`, and `timeout: false`; argv, cwd, and timestamps match the phase ledger. Both install stderr files are empty. The registry-query stderr contains only npm’s version-update notice.

The bounded phase ran 56.553959 seconds through the last runtime end (`2026-08-30T11:35:25.586661Z`) and 61.385305 seconds through the root-accepted CPU release (`2026-08-30T11:35:30.418007Z`), below the 480-second bound. The accepted release record reported zero owned runtime processes; this review did not forge a later process-absence observation.

Installed package metadata is `poe-code@13.0.1`, with root floors `shell-quote@^1.9.0` and `gray-matter@^4.0.3`. The runtime contexts resolved these physical paths and versions:

- `poe-code/dist/agent.js` via `createRequire`: nested `shell-quote@1.10.0`.
- `poe-code/packages/experiment-loop/dist/frontmatter/frontmatter.js`: bundled `gray-matter@4.0.3`.
- That `gray-matter` context: nested `js-yaml@3.15.1`.
- Deliberately unrelated consumer seeds remained distinct at `shell-quote@1.8.4` and `js-yaml@3.14.2`.

The same SHA-256 `808fe0cdc3ac85a362b333529aa540649ac8eae7e619f473cf402d14e616fff8` probe exited 0 under Node `v22.22.2` and Node `v18.18.0`. Both runs matched the physical metadata, observed benign shell parsing and a YAML alias, and confirmed canonical/legacy ESM identity for `poe-code/safe-js` and `poe-code/safejs` at root, core, and CLI. Bin metadata targets were identical. The exact control predicate rejected 1.8.4 and accepted 1.9.0 and 1.10.0. The original lexical-bug probe exits `1/1`, resolver-fixture errors, and unsupported old timestamps remain historical facts, not rewritten successes.

## Security scope retained

The source audit evidence—not a fresh consumer audit—records 31 unique baseline GHSAs, 3 candidate GHSAs, 28 removed, 0 added, and 25 unchanged-scope lock-record operations. The held identifiers are `GHSA-3jxr-9vmj-r5cp`, `GHSA-mh99-v99m-4gvg`, and `GHSA-rgw5-rvv9-x895`. Held `brace-expansion@5.0.6` appears below `@ts-morph/common`, `braintrust`, and `test-exclude`. T3 remains held and policy resolution remains outstanding.

The selected actual consumer-path validation supports the bounded published patch together with the historical source delta. It does not prove the complete actual consumer graph audit-green, map every advisory to a physical check, or establish `securityAllClear`.

## Explicit limits

- No CLI bin, agent caller, frontmatter caller, browser condition, MCP, OAuth, or universal-consumer flow was executed. Browser condition fields were metadata-only null observations.
- No whole Node 18 suite, clean all-source equivalence, minimum-Node-22 policy answer, engine waiver, fork validation, build, test, TypeScript check, audit, registry call, or download occurred in this final review.
- Historical paired Node 18 source results remain build/package-lint `1/1` on both sides at base `49eea61131a83e2713c5b7ca3b198631bef7be4c`, with the matched `node:sqlite` invalid-external blocker at `scripts/bundle.mjs:423`; candidate tasks were 66/68 cached. Historical `dd799` matched 99 assertions per side but exited 130/130, included an extra Toolcraft fake test, and has unknown shutdown state.
- The earlier `npm init -y` was unisolated, so there is no all-commands-isolated or home-untouched claim. Continuation application commands used owned environment locations, but light metadata work is not generalized into that claim.
- Root-authorized cleanup removed only the source clone's `node_modules` and `.turbo` caches (443,736,064 allocated bytes total). Source package, lockfile, Git data, output, and tar evidence were retained; the source clone is not claimed installed or rebuild-ready. Dirty fonts/source output remain outside publication scope.
- The retained ENOSPC addendum attempt did not create an artifact. No missing artifact is represented as present.

At exact release commit `a709a292997bc167d594a736391df64e3a432c68`, this report path is absent (`git cat-file` exit 128). That is the only preimage claim; a later publisher must compose this one-file docs patch against its then-current target and run normal current hooks.
