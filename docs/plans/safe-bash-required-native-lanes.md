# Required native release lanes

## Scope

Retain all existing native semantic assertions and historical profiles. The
normal Release workflow checks out the triggering SHA in both jobs. Its stable
publication job requires the Darwin native job to succeed; observation-only
dispatches remain separate and cannot publish.

`SAFE_BASH_NATIVE_LANE=linux` selects the complement of the explicit
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

## Complete local prerequisite follow-up

The bounded active-unit scan at `dfe66a4795c56fa4594ee1efcd9009d02cba1912`
covered 652 active test files and their 1,116-file relative source import closure.
It found required historical GNUtar and coreutils `chmod`, `stat`, `mktemp`,
`touch`, `expr`, `nl`, `seq`, `unexpand`, `paste`, `comm`, and `join`, plus
the existing independent second stat build. Source prerequisites include the
exact coreutils archive, five selected C sources, and `doc/coreutils.texi`.
The existing source provisioner already stages all these source members.

Original `.oracle` artifacts also supply the existing optional local `date`,
`sleep`, `printenv`, `split`, and `du` cohorts. Their exact original files were
restored without rebuilding or changing any test pin. Version-only historical
time/env inputs remain version-only; copy checksums are not new qualification.
The complete affected local stream/table/split/du/time-env cohort passed 1,157
tests with zero failures or skips. Original artifact bytes and metadata remain
unchanged. No README, dependency install, source rebuild, or home skill sync is
needed for restoration.

The existing authenticated Darwin qualification contains independent matching
builds of `nl`, `seq`, `unexpand`, `paste`, `comm`, and `join`. The reviewed
manifest now supplies those outputs through the unchanged staging mechanism.
Existing stream/table native assertions, Apple `rev`, and BSD `stat -f` run on
the required Darwin lane. Historical captures and diagnostic expectations stay
unchanged; native caller bindings remain separate from executable qualification.

The scan also identified the Apple `/usr/bin/split` pin in existing split native
tests. Six split files now belong to the Darwin inventory. Both GNU and Apple
split binding types are supported, but the current qualification artifact does
not establish either hosted split identity. The existing qualification recipe
now builds GNU split twice and records a bounded, codesign-verified Apple split
observation in its existing sealed receipt. Run the existing `darwin-gnu-build`
qualification after publisher integration, review the resulting source-bound
identities, and only then add those exact pins to the qualified profile.

Apple split has no successful `--version` mode: it returns 64 and usage text.
Its reviewed `versionProbe` must match that exact status, empty stdout, and full
stderr transcript in addition to all existing path/size/hash/identity checks.
The `version` field is explicitly an identity label for this tool, not claimed
native version output. Ordinary GNU and other Apple version checks are unchanged.
No local hash is substituted for a hosted pin. Do not count local restoration
or GNU stream qualification as closing this remaining hosted prerequisite.

The first integrated push exposed three census regressions (336 runner tests
passed): the final metadata binding test was not listed as an integration
addition. Register that exact path while retaining the historical 655/654/653
counts, historical membership hash, and complete current discovery assertions.
The repaired complete runner suite passes 339/339 with zero skips.

Publisher validation on Node 22.22.2 completed the default local package route:
339 runner tests passed, followed by 20,543 unit tests passed, 77 existing optional
skips, and zero failures across all 655 active TypeScript files. The earlier
disk-exhaustion run remains recorded; its four exact failing cases passed with
zero skips after generated-only cleanup, before the complete successful rerun.
No assertion, test limit, hook, or optional-profile policy changed for this retry.
