# Hosted Darwin GNU build qualification

## Scope and present status

This is an explicit trusted-main qualification job, not release admission. It
adds no native caller bindings or product changes. Ordinary pushes and default
dispatches retain the existing release steps, permissions and concurrency. The
previous ten-minute metadata-only job is unchanged.

Metadata run `33398563411` observed macOS 26.5.2 / 25F84, arm64, image
`20260728.0273.1`. The image is anchored to the official runner-images commit
`b40db0eab3fbc4c6113ce4afa67020b8c59fe0a4`, tag
`macos-26-arm64/20260728.0273`, and the successful Apple code-signature checks.
The reviewed Apple identities are qualification inputs only. Historical
26.4.1 / 25E253 records remain in the manifest and their existing consumers are
unchanged. New GNU hashes must not become admission authority merely because
this job observed them.

## Maintained invocation and boundaries

Dispatch the existing Release workflow on `main` with
`qualification=darwin-gnu-build`. The separate job uses `macos-26`, Node 22.22.2,
`contents: read`, a resolved `${{ github.sha }}` checkout without persisted
credentials, and a 60-minute bound. There is no publish token, secret input,
global installation, Homebrew installation or artifact cache restoration.

The existing package provisioner accepts the explicit
`--qualify-darwin-build --parent <private-directory> --destination <parent>/build`
mode. Its parent must be an actual mode-0700 directory directly under the
canonical `RUNNER_TEMP`. The program verifies trusted repository, main ref,
dispatch event, hosted runner, architecture, image, resolved checkout SHA,
OS/build/kernel, Xcode, compiler, GnuPG version and the three reviewed Apple
binary hashes/code signatures before fetching sources. Drift fails closed.

The workflow passes only the required GitHub/runner identity variables,
`GITHUB_OUTPUT`, `RUNNER_TEMP`, private `HOME`/`TMPDIR`, and a bounded tool PATH.
Build children receive a fresh environment containing only private paths,
`LC_ALL=C`, `LANG=C`, `TZ=UTC`, and the fixed `SOURCE_DATE_EPOCH`. There is no
ambient environment dump in retained evidence.

## Authentication and independent builds

The retained Linux profile was measured on Ubuntu 24.04.4/x64 with GCC 13.3.0.
Tar, diff and patch have matching independent builds; the real private Linux
provisioner completed normally and its unchanged 774-case native cohort passed.
The source/image/compiler provenance and fixed executable hashes are recorded
in `packages/safe-bash/tests/native-gnu-profiles.json`. This commit does not
roll that profile out to current test callers or claim Linux can satisfy the
historical Apple obligations.

The fixed manifest contains GNU tar 1.35, diffutils 3.12, patch 2.8 and coreutils
9.7 archive size/hash pins, detached-signature pins and expected signer
fingerprints. Downloads use the existing HTTPS/size/hash verification helper.
The public GNU keyring is also pinned and signature verification must succeed
with the exact expected signer before extraction. The keyring and private
verification home are excluded from artifacts.

Build tar/diff/patch once each. Extract and configure coreutils twice in distinct
new directories and build the selected 14 tools, including two independently
built `stat` executables. There is no `make install`. Fixed compiler options and
prefix maps are recorded. Each selected regular executable is measured before
and after its real version invocation. Compare the two builds explicitly;
differences are reported, never normalized or silently admitted.

Each build command retains stdout/stderr and its explicit arguments/environment,
with the existing ten-minute command bound, 16-MiB output bound, one-GiB space
floor and owned-process-group cleanup. A failed build leaves a failure receipt
and available bounded evidence; it does not become a successful qualification.

## Retention and next gate

Only authenticated source archives/signatures, selected GNU executables,
configuration/build/provenance logs and identity receipts enter the sealed
artifact. Reject links, special files, unexpected members or unsafe paths.
Limits are 512 members, 16 MiB per member and 128 MiB total. A tar container
preserves executable modes; its maximum size is 129 MiB. Upload only that tar and
its digest for 14 days. Do not upload keys, private homes, checkout contents,
environment dumps or credentials. Download promptly, verify the digest and
member manifest, and retain the observations locally.

After review of actual GNU output identities, separately qualify the original
13 Darwin obligations in all seven complete calibration/expr/dual-stat files.
No Apple assertion is moved to Linux, skipped or replaced. The second stat
binding must use the real second build. Profile/caller rollout and split release
gating remain a later, separately qualified change.

## Validation record

The preserved Linux provisioner baseline has 13 passing memfs tests. Four added
Darwin groups first failed because the required behavior was absent. The
implemented tests cover context drift, independent extraction, source/signature
failure, compiler/checkout mismatch, Apple byte/signature identity, explicit
unreviewed output differences, artifact membership/size/link rejection and CLI
mode separation. A Node 24 RED exposed same-size mutation during Apple signature
verification without a detectable fixture timestamp change. The verifier now
rechecks content as well as metadata; selected GNU outputs receive the same
post-version content check. The full 20-case provisioner set passes unflagged
Node 18.18.2, 22.22.2 and 24.14.0. Hosted build observations are still pending.
Unit tests never create real filesystem fixtures. Workflow
validation uses `npm run lint:workflows`, not workflow unit tests.

Automatic release `33398507670` failed its ordinary tests; schema
`33398507696` and metadata `33398563411` succeeded. Registry 13.0.10 remained
unchanged at that checkpoint. Native caller rollout, timing-fixture repairs,
camera optimization and od fixes are separate work; this build job does not
claim those release failures resolved.

## First hosted build and tar linkage correction

Run `33406202546` used the reviewed hosted image and Apple identities. Source
and signature authentication and tar configuration passed. Configuration
identified working system iconv and `-liconv`, but tar's link failed on
`_iconv` and `_iconv_open`. Preserve the failed 54-member artifact and its raw
logs; no GNU executable was produced or admitted.

The bounded correction adds `LIBS=-liconv` only to the Darwin tar 1.35
configure arguments. Linux, diffutils, patch and both coreutils recipes keep
their existing argument lists. Source/signature/version pins, compiler flags,
conversion behavior and profile admission do not change. There is no upstream
source patch or global library installation.

The added argument regression first failed specifically on the absent
`LIBS=-liconv` while the original 20 tests passed. It checks complete configure
argument arrays for all four Darwin sources and the existing Linux build.
Actual corrected hosted compilation and subsequent semantic calibration
remain required; unit argument tests are not proof of successful linkage.
