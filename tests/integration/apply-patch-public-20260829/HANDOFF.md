# Public apply_patch79 — qualified author handoff

2026-08-29. **Independent public acceptance is pending.** One author execution
completed; its four failed assertions remain red. Two exact fixture corrections
are committed and source/data-justified, but have not been executed. No retry.

## Source, composition and full package

- Root integration: `83730c6085597d8480a25aa639793582984eebd0`.
- Accepted module, unchanged: `753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d`, exactly
  six files under src/commands/apply-patch; adjudication `c1fc3ee8a010289145959a05e8b088e51f21780a`.
- Accepted base: derived coherent78+arrays `d111e5bf1f53aff16c5d4112e9ead2e025d6464f`.
- Executed derived candidate: `e83d6c481e3c17b56fe32a17593628d8d7c820a9`;
  SOURCE.json SHA256 `c2cffb6d132f8fae85f5fe80382d653753a1cffba14b82e78b3ad62679ee9559`.
- Fixture-only successor: `7fde32264d757ef856acf3ae92c8581b4a294341`;
  SOURCE-v2.json SHA256 `da431477e0cf1072370b8e55cdebce80e33dbf9cac8471656854572b363b9d0d`.
  All278 build inputs are byte-identical to the executed candidate. Only one
  maintained test blob changes; public-v2.mjs is separate review-fixture input.
- Actual full898-member,814632-byte tarball SHA256
  `643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd`, retained in
  results-v1/PACKAGE.tgz.base64. It is not rebuilt/replayed after fixture correction.
  Compared with base874:24 added emitted members are only the six apply-patch
  modules;10 changed common members are root/plugin JS/declarations/maps, package
  metadata and README. Other864 common members are unchanged; none removed.

These are reconstructed composition identities, not assertions of stored Git
tree objects. SOURCE/SOURCE-v2 carry fixed blob/mode/length/hash origins and tree
witnesses. No rawHEAD, Git, YQ, XAN, Node, declare or mapfile source is included.
Root package version/engine profile and zero runtime dependencies are unchanged.

## Public API and policy

Root and `virtual-bash/commands/apply-patch` export:

```ts
createApplyPatchCommand(options?: ApplyPatchCommandsOptions): CommandDefinition;
createApplyPatchCommands(options?: ApplyPatchCommandsOptions): readonly CommandDefinition[];
applyPatchCommands(options?: ApplyPatchCommandsOptions): VirtualShellPlugin;
```

Types: ApplyPatchCommandsOptions and ApplyPatchLimits. Aggregate key:
`applyPatch?: Omit<ApplyPatchCommandsOptions, "replace">`. Only `limits` is forwarded;
top-level `replace` is authoritative even for untyped nested overrides. Standalone
factories retain their own replacement policy. Default79 adds only `apply_patch`;
curl/SafeJS stay optional and getopts is a builtin, not an extra plugin name.

Bounded literal UTF-8 VFS patching only: one argument or stdin; Add/Update/Delete/
Move envelope, finite lowerable maxima, no native patch fallback or runtime deps.
Staging is not multi-file transaction/rollback; output/caller failure may occur
after file publication. Existing module behavior and all acceptance qualifiers stay.

## Actual one-run outcomes

| Cohort | Source-build | Installed | Physically moved |
| --- | ---: | ---: | ---: |
| New public cases |27/28|27/28|27/28|
| Unchanged arrays |12/12|12/12|12/12|
| Selected unchanged coherence |18/18|18/18|18/18|
| Strict public types |pass|pass|pass|
| Removed-directive type negatives |4 exact diagnostics|4 exact diagnostics|4 exact diagnostics|

Coherence selects C02-C18 plus separate R15; historical C01=78 remains immutable
and is not included/rescored. New P02 explicitly checks the independent79-name
vector. Cases include ARRAY/scalar/function/source/subshell/invoke/shared budgets,
STACK/CDPATH/dotglob/LET/getopts/jq, timeout and explicit mock-curl cleanup. No actual
SafeJS engine, native oracle, provider service or external network execution.

Four maintained TS fixture bodies: **82/83**,0skip/0cancel. Their six-source
compilation routes only import specifiers to the authenticated package; all
bodies otherwise remain exact current versions, including native-call denial in
the test host. Separate moved stream-five consumer: **21/21**.

One actual strict production build and offline scripts-disabled pack/install;
physical relocation followed by bare public imports. Six compiler groups passed.
Nine runtime batches each authenticated220 distinct loaded product modules;
all observed product declarations resolve to the actual layout's package hashes.

Six controls passed: loaded registration-omission mutant killed by P02; exact
artifact restore; missing root member; changed module member; outside compiled
root; removed explicit subpath export. These are one semantic mutant plus restore
and four binding/export refusals, not six product positives or independent proof.

## Four failures and exact unexecuted correction

1. P05 in each layout compares `commands.get('custom')` with the constructor input
   object. Selected CommandRegistry.register freezes a copy before setup. Correct
   preservation identity is the registry entry captured before aggregate setup.
   New public-v2 captures that entry and the previous apply_patch entry; requires
   exact custom identity/function retention and actual apply_patch replacement.
   All other27 cases are byte-identical; original public.mjs/results remain.
2. Maintained stream-inspection test at line34 omitted apply_patch from its literal
   post60 name tail, despite correctly asserting79/79. Append only that authorized
   name. No input or prior name/order/output expectation changes.

Correction commit `6bcb55615cbe21ee7738f3c8f1ced8a490102bb2`; FIXTURE-v2.md and
SOURCE-v2.json bind it. **Corrected outcomes are UNEXECUTED.** Do not call the old
27/28 or82/83 green. A different reviewer must verify these deltas and actual public
integration before ROOT acceptance. The old sealed run.mjs/EXECUTOR are a consumed
one-shot version and must not be blindly rerun against updated maintained files.

## Resources, evidence and remaining limits

28 serial direct children all closed naturally,0 signals;36.678s elapsed;
2,964,466 captured child bytes;66,273,312 actual scratch bytes. This fits the
30min/64-child/peak4/128MiB capture/512MiB working grant. No new process/Worker
census, physical-memory, arbitrary-host-preemption or hard kernel-drain claim.
P26 proves callback registration/idempotency, not universal cleanup telemetry.

Retained root: /var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/apply-patch-public-author-KR4Jg8.
98 top-level descriptors;96 embedded, full tar separate and source blob stdout
bound by selected Git inputs. Encoded RAW SHA256
`33624b6f56dda1d767ad5d1a385af998e4f5ee1559d7bbb7d8749f7a4b4e8a6b`.
All source/dist/package postguards passed. AUDIT.json records per-file differences,
loads, exact failure rows, types, controls and the unchanged successor build list.

Module legacy11 failures/21 uncredited observations, L07 raw7/9 and two-owner
adjudication remain untouched. No public M1B Git integration or broad global gate,
GNU/native parity, rollback, universal resource closure or superiority claim.

## Reviewer inputs

Use fixed SOURCE-v2 plus the retained exact full tar and public-v2.mjs (not moving
HEAD). Reconstruct all278 build inputs from declared blobs; do not require a
derived tree to be a stored object. Recheck root/subpath/types, exact79 names,
global replacement, arrays/crossfeatures and the two versioned fixture fixes.
Suggested additional mutations: replace the retained custom entry, fail to replace
the previous apply_patch entry, and remove/add an unexpected inventory name.
These suggestions have not been executed here. No second author run is claimed.
