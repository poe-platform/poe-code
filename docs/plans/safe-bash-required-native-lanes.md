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

## Hosted split admission

The existing qualification run 33441925913 succeeded at source
`e91ecba8bdd56c4dd9285a3bc64336ce479aec84`. Artifact 9777161068 has ZIP SHA-256
`53c72338dadff27f26707424b6869192ac2fde4ff8f1079db3a59efef2a3b9da`;
its `native-darwin-evidence.tar` has SHA-256
`e45dc7eca42d669953a879b061d5d98234a17048b1c245b1610d7732e24b0812`.
The closed 260-member seal, source signatures, exact checkout, Node 22.22.2,
macOS 26.5.2 / Darwin 25.5.0 arm64, image 20260728.0273.1, Xcode 26.6
17F113, clang 21.0.0, and GnuPG verifier 2.5.21 match the existing recipe.

GNU coreutils 9.7 split was built in two distinct source/build directories.
Both regular executable artifacts are 98,104 bytes with identical SHA-256
`431baf88042ddf120074d3ab58172d27af404d3fa88e45c39747cde1a8b4557a`.
The source-bound Apple `/usr/bin/split` observation is 134,768 bytes, SHA-256
`3b18ccdd81d67e0f287b5bdd1ecf23a2bff0525ba488ada79b41f653ee1a34f0`;
strict codesign verification succeeds with Apple signing authority and
`com.apple.split` identity. Its exact exit-64, empty-stdout diagnostic transcript
is retained in the admitted record. All 14 previously admitted GNU identities
match this run; their original pins and provenance remain unchanged.

These two records close the missing hosted split identity prerequisite only.
The follow-up normal Release must still pass the required same-SHA Darwin
semantic cohort and Linux complement before publication. No local legacy pin,
semantic assertion, selection inventory, workflow, or optional gate is changed.

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

## Explicit local diff/patch recovery

The follow-up at `cb89faa6a5971f037202ae2f60fe2f3b86bed59a` found the historical
temporary GNU diff/patch directory missing. The original source/compiler recipe
rebuilt both versions but did not reproduce their frozen executable hashes.
Those outputs remain unreviewed; the original `f13ef516...` diff and
`c060444d...` patch pins and historical captures are unchanged.

Root authorized separate local qualification, not a hosted-binary substitution.
On macOS 26.4.1 build 25E253 / Darwin 25.4.0 arm64, two independent source trees
per tool used the existing signed-source Darwin recipe: fixed
`--prefix=/native-qualification`, `--disable-nls`, `/usr/bin/clang`,
`CFLAGS=-O2 -g0 -ffile-prefix-map=<independent-work>=.`, `make -j2`, and the
existing `SOURCE_DATE_EPOCH=1743984000`. No install command ran. Source archives,
detached signatures, keyring hashes, and signer fingerprints match the existing
manifest. The receipt retains actual compiler/linker/verifier hashes, Xcode 26.6
17F113, clang 21.0.0, SDK 26.5 build 25F70, and GnuPG verifier 2.5.21.

Each independently built pair is byte-identical: diff 3.12 is 247,416 bytes,
SHA-256 `db41e94dab136447ec244e48c3ce2f889928bc844d6ca5772d815d06328474b0`;
patch 2.8 is 194,312 bytes, SHA-256
`f9e0dc02b9aa6589a7b31f9258c33b22511261ae69fdab5c5ca8848971f440bd`.
These happen to match hosted output bytes, but all four qualification outputs
were compiled locally and verified separately. The 101-member evidence seal is
under `packages/safe-bash/tmp/native-local-diff-patch-qualification-20260831/evidence`:
receipt SHA-256 `3eb3c0301a1c94bf654a2959e360047f977de46ef86197b863dd77999f027c15`,
manifest SHA-256 `301662f064dc9e2663993a3497e9027127145dcc36574c4255944c26f3d862b2`.
The immutable producer receipt remains `BUILT_OBSERVATIONS_UNREVIEWED`; the
separate completed review is `out/math-array-validation/native-local-recovery-review.json`.

The additive local profile contains exactly diff and patch. Only explicit
overrides naming the stable publisher-owned paths below select it. Absent or
other overrides retain legacy authentication; all other GNU tools and all Apple
tools retain their Darwin 25.4 fallback. Hosted profiles and recipes are unchanged.
The existing provisioner stages exact verified copies; no new configuration API,
host lane, optional gate, or qualification framework is introduced.

The first complete 75-file cohort exposed 109 stale identity assumptions, with
3,743 passes and zero skips. Direct native callers now use the selected admitted
identity; historical capture metadata still checks the original pins, and full
native version-banner comparisons remain intact. After focused TDD controls,
all 75 active diff/patch files pass: 3,853 tests, zero failures and zero skips.
The successful log SHA-256 is
`a5f712081e2a0d28affd1b4d3406dcec1554bef815ebae248fb260e9a420ab53`;
its source/selection receipt SHA-256 is
`7b1d5b1275c0fbd5e614d5b41bb8c37783ad5577022bcefd721ab06a45928dce`.

From the publisher repository root, retain these existing overrides for normal
hooks and re-run the fresh-process identity preflight before every full retry:

```sh
export DIFF_PATCH_NATIVE_DIFF="$PWD/packages/safe-bash/tmp/native-local-diff-patch/bin/diff"
export DIFF_PATCH_NATIVE_PATCH="$PWD/packages/safe-bash/tmp/native-local-diff-patch/bin/patch"
node --import tsx --input-type=module -e 'import { oracleIdentity } from "./packages/safe-bash/tests/commands/diff-patch-stress/gnu-target/oracle.ts"; for (const tool of ["diff", "patch"]) console.log(JSON.stringify({ tool, ...oracleIdentity(tool) }));'
```

Publisher still owns independent review, normal commit/push, and full package
and hosted Release gates. This focused qualification is not a full-release pass.

## Required Bash recovery, 2026-08-31

The next normal push at `a43a8142603a9d3d5ec31c6fb7ffe7d469884885`
exposed a genuinely required Bash executable, not capture-only data:
`tests/shell-stress/diagnostic-profiles/compatibility.test.ts` failed all89
cases when `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash` was absent.
Bounded task-cache and explicit oracle lookups found no original executable.
Its historical SHA-256 and all frozen captures remain unchanged.

The authenticated Bash5.3 archive is exactly11355854bytes, SHA-256
`0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba`.
Its95-byte detached signature is
`bd32023612c9554182393b10d9db909fc5e35e2f07b38e327ff65e500288a9ad`;
the existing pinned GNU keyring verifies signer
`7C0135FB088AAF6C66C650B9BB5869F064EA74AB`. Two independent local
Darwin25.4 source trees use the existing deterministic configure recipe:
`--prefix=/native-qualification --disable-nls CC=/usr/bin/clang`,
`CFLAGS=-O2 -g0 -ffile-prefix-map=<build-tree>=.`,
`SOURCE_DATE_EPOCH=1743984000`, then `/usr/bin/make -j2`.
Actual compiler, linker, SDK, OS and verifier identities are recorded and
rechecked against the preceding independently reviewed local toolchain.

Both real Bash5.3.0(1) outputs are1188024bytes, SHA-256
`bfa389cd1d6cb5dbd03805612b6fe464ade9b22a343b897df09044ff90456528`.
The64-member closed evidence is under
`packages/safe-bash/tmp/native-bash-qualification-20260831/evidence`.
Receipt SHA-256 is
`6234bac65f72ade41c36cef6ae86feb9cb2a43d11985a5a330d84a433d4f2ccb`;
manifest SHA-256 is
`a5e19ded418df5f19c9f87d75920ba925a8b81b57e819691c019a5c9cd5626a2`.
Producer observations remain unreviewed records; separate verification is
`out/math-array-validation/native-bash-artifact-review.json`.
The original build process had loaded the pre-gzip sealing implementation;
its completed outputs were subsequently sealed with the tested gzip extension.
No build failure, source substitution or binary change was hidden by resealing.

Only the local profile gains Bash; prior records/recipes are structurally
unchanged after removing the explicit additive Bash entries. Existing staging
installs authenticated copies under `packages/safe-bash/tmp/native-gnu/bin`.
Bash uses `nativeGnuBinding("bash")` at that stable path, with no new environment
variable; diff/patch keep their previously documented explicit overrides.
All other GNU/Apple tools retain the local legacy fallback. Euler owns the
separate caller adapter and its tests; historical identity assertions remain
separate from the selected current executable identity.

Validation: actual89/89 compatibility tests pass with zero skips, including
full version tail, original lifecycle, source bindings and frozen semantics.
The167-test core/caller/selector run passes with zero skips; scoped package
TypeScript and whitespace checks pass. Discovery remains complete and disjoint:
656files =619Linux +37Darwin. Logs and final evidence are
`out/math-array-validation/native-bash-actual-89.log`,
`native-bash-core-green.log`, and `native-bash-final-review.json` in that directory.

The same compatibility file is now an obligation of the existing required
Darwin lane. Existing hosted qualification records two independent Bash builds
from the same authenticated gzip source; staging verifies both against the
eventually reviewed hosted pin. No hosted Bash identity is inferred from local
bytes or admitted yet. Publisher must dispatch the existing Darwin qualification
after the recipe reaches remote main, review its actual receipt, and add the
exact hosted record before publication can pass. Same-SHA checkouts, publication
dependencies, exit statuses and workflow behavior are unchanged.

Fresh authenticated Bash preflight, from the publisher repository root:

```sh
node --import tsx --input-type=module -e 'import { resolveCurrentProfile } from "./packages/safe-bash/tests/shell-stress/diagnostic-profiles/profile.ts"; console.log(JSON.stringify(resolveCurrentProfile()));'
```
