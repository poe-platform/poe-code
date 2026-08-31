# Required native release lanes

## Scope

Retain all existing native semantic assertions and historical profiles. The
normal Release workflow checks out the triggering SHA in both jobs. Its stable
publication job requires the Darwin native job to succeed; observation-only
dispatches remain separate and cannot publish.

`SAFE_BASH_NATIVE_LANE=linux` selects the complement of the explicit 20-file
`darwinTestFiles` inventory in `tests/native-gnu-profiles.json`.
`SAFE_BASH_NATIVE_LANE=darwin` selects those complete existing files on macos-26.
The inventory covers AppleBSD archive/patch assertions, Darwin expr behavior,
metadata permissions, and independent stat comparisons. Selection fails for
wrong hosts, missing obligations, duplicates, or empty lanes. Default local
discovery remains complete. The root runner scopes the selector to virtual-bash
unit execution. Darwin sets `ARCHIVE_LONG_LINK_NATIVE=1`; missing native archive
inputs fail rather than skip in the required lane.

## Executable evidence

Darwin qualification run 33416850321 succeeded at source
`e537758e579b1dac2b3ed9c765d456cdef3b6d84`. Artifact 9767591666 contains
`native-darwin-evidence.tar`, SHA-256
`2e46f5542b4f8e10ecdf1246a3cfc06973b55333ed492100abd5548208e9f94b`.
Its authenticated build receipt provides the new executable identities for
macOS 26.5.2 / Darwin 25.5.0 arm64, runner image 20260728.0273.1.
Executable qualification is not a native semantic pass.

The required job reuses that existing signed-source build recipe and verifier,
then admits only committed reviewed hashes, sizes, and versions. Both actual
stat build outputs are independently checked and staged to distinct private
directories. Historical source/capture hashes and legacy Darwin 25.4 executable
profiles remain unchanged. The lane uses Node 22.22.2, private HOME/TMPDIR, and
`SKIP_SYNC_SKILLS=1`; no real-home skill synchronization is needed.

## Verification and delivery

Use focused provisioner, binding, selector, and root runner regressions; scoped
TypeScript checking; and `npm run lint:workflows` (no workflow unit tests).
The next normal hosted Release must execute the selected native assertions and
the Linux complement at the same SHA before publication. Publisher owns the
normal commit/push and hosted-run monitoring; local source validation alone does
not establish release success.

The first integrated push exposed three census regressions (336 runner tests
passed): the final metadata binding test was not listed as an integration
addition. Register that exact path while retaining the historical 655/654/653
counts, historical membership hash, and complete current discovery assertions.
The repaired complete runner suite passes 339/339 with zero skips.
