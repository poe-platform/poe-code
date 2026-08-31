# Native Git test prerequisites

## Scope and ownership

At integration HEAD `9fde5bc8c3ec1ad66acc78951228801b58b16342`, change only
editflows Git prerequisite helpers/profile/tests and this plan. Publisher owns
integration/push; the GNU binding worker owns native-profile.ts, GNU callers and
release provisioning. No production, workflow, dependency, commit or push changes.

## Implementation and TDD

1. Add in-memory admission controls and host-selection regressions first.
2. Reuse the existing native host matcher; retain exact executable path, regular
   non-symlink file, canonical spelling, size, mode and SHA-256 authentication.
   Require canonical non-symlink directory identity for git-core.
3. Keep the historical local identity and the ten native semantic oracle cases.
   Add only identities observed in exact source/logs; no PATH search or fallback.
4. Run the focused controls, unchanged native oracles, complete editflows suite
   and scoped strict typecheck. Report unqualified hosts as blocking, never skips.

## Evidence reviewed on August 31, 2026

- Local Darwin arm64 kernel 25.4.0 identity re-observed unchanged: Xcode.app Git,
  3704880 bytes, mode 0755, SHA-256
  `10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9`.
  Historical semantic evidence remains in editflows/README.md.
- Metadata run `33415695597`, source
  `e537758e579b1dac2b3ed9c765d456cdef3b6d84`, observed Darwin arm64 kernel 25.5.0,
  image macos26 `20260728.0273.1`, canonical
  `/Applications/Xcode_26.6.app/Contents/Developer/usr/bin/git`, 7604272 bytes,
  mode 33261 (0755 permissions), SHA-256
  `e68bc9395203d8e1be47b98c374df67ccb45732379a9fdba94b56d861e5f648f`.
  Version: `git version 2.50.1 (Apple Git-155)`; exec-path and canonical directory:
  `/Applications/Xcode_26.6.app/Contents/Developer/usr/libexec/git-core`.
  Codesign strict verification and Apple signing-chain display both exited zero.
  Observation authenticates this binding, not the ten-case hosted semantic gate.
- Push Release `33415613420` is Linux and failed; it is not the metadata run.
  Its checkout reports `/usr/bin/git` version 2.55.0, but no concrete executable
  SHA-256, size, permission mode, canonical/non-symlink identity or git-core
  canonical directory identity. The official assigned-image SBOM and its exact
  package subsequently supplied an independent binding, documented below.
  Expectations are never derived from the current executable under test.

## Validation

- Red: `node --import tsx --test
  packages/safe-bash/tests/commands/diff-patch-stress/editflows/git-profile.test.ts`
  exited 1 with `ERR_MODULE_NOT_FOUND` before the implementation existed.
- Green: the same command passed all 15 qualification-control tests, with zero
  failures, skips, cancellations or TODOs. Fixture bytes and their real computed
  digest are confined to memfs; they never replace a production profile's pin.
- `node --unhandled-rejections=strict --import tsx --test --test-concurrency=1
  packages/safe-bash/tests/commands/diff-patch-stress/editflows/*.test.ts` passed
  all 47 tests in approximately 1.55 seconds, including the unchanged ten-case
  native oracle cohort. This local execution used the historical authenticated
  Darwin Git and GNU diff 3.12/patch 2.8; it is not Linux or hosted Darwin execution.
- `node_modules/.bin/tsc --noEmit -p
  packages/safe-bash/tests/commands/diff-patch-stress/editflows/tsconfig.json`
  passed, as did scoped `git diff --check`.
- No visual CLI change; no screenshot requirement applies. No shared dependency
  installation, workflow edit, production change, staging, commit or push occurred.

## Integration handoff

No shared binding API change is required. The host matcher is consumed without
modification. Linux now has its own independently sourced binary pin; it does not
reuse the Darwin identity. The new Linux and hosted Darwin bindings still require
actual semantic execution on those hosts. Unknown hosts deliberately fail, rather
than skip or accept arbitrary executable bytes. Publisher retains integration and
release ownership; GNU worker owns its planned read-only Linux metadata logging.

## Linux identity recovery

The artifacts API for run `33415613420` returns `total_count: 0`. Its startup
logs bind Ubuntu 24.04.4, kernel 6.17.0-1022-azure, image `20260823.283.1` to
`actions/runner-images` tag `ubuntu24/20260823.283`. That tag's install-git.sh
installs Git from `ppa:git-core/ppa`; its official SBOM identifies package
`1:2.55.0-0ppa1~ubuntu24.04.2`, architecture amd64. The tag resolves to runner-image
source commit `73a898e845210ee1565a4bb3328897e152dd73ae`.

The official release asset `sbom.ubuntu-24.04.json.zip`, asset ID `533526178`, is
26811299 bytes. Its downloaded SHA-256 matches the GitHub asset API digest:
`58fb1c0c29c06117daf4628f7c6c629c07e49dec9a49b44ecd04ca8e7b5c306a`.
Its SPDX file records independently pin both `usr/bin/git` and
`usr/lib/git-core/git` to SHA-256
`d4d2ba562243015206d4248edfec871a74786499292d00ed072dbca2f5ae8073`.
The `git` package record names the exact version above and its DPKG provenance.

The corresponding upstream package was downloaded without installing or executing:
`https://ppa.launchpadcontent.net/git-core/ppa/ubuntu/pool/main/g/git/git_2.55.0-0ppa1~ubuntu24.04.2_amd64.deb`.
It is 7409882 bytes, SHA-256
`6238a37c11c1bd4b18a5194f766ccfcb2f26c116e7d8ecd07bac143863b69498`.
Reading its archive metadata in memory yields regular `./usr/bin/git`, size
4576040, mode 0755. Hashing that member's bytes exactly matches the independent
SBOM SHA-256 above. `./usr`, `./usr/bin`, `./usr/lib`, and `./usr/lib/git-core`
are directory entries, mode 0755, with no symlink targets. No executable bytes
were printed, installed or committed. Runtime admission still verifies actual
canonical/non-symlink executable and git-core paths before any Git invocation.

No new artifact infrastructure or metadata dispatch job is necessary. The proposed
new-job route was discarded once the official image binding was recovered. GNU
worker's independently owned observation at the beginning of normal Linux
provisioning will corroborate the fixed pin and actual checkout/trigger/run/image
identity. It never auto-admits observed bytes. Publisher's normal Linux test gate
must execute the unchanged semantic cohort; pin recovery alone is not that gate.

Linux-specific TDD red: the new SBOM/package binding regression failed with
`UNAVAILABLE native Git: no qualified executable identity for
linux/x64/6.17.0-1022-azure` (15 pass, 1 fail; node exit 1) before adding the record.
Green: all 16 profile/admission tests pass. The complete unchanged editflows
cohort plus the new controls reports 48 passed, zero failures/skips/TODOs or
cancellations, in approximately 1.29 seconds on local Darwin. Scoped strict
TypeScript and `git diff --check` pass. The ten native semantic oracles remain
unchanged and passing locally; actual Linux semantic execution is still owned by
the publisher's maintained release gate. These source changes are ready for that
integration, not a claim that publication has occurred.
