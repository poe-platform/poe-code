# Conditional profile repair — author handoff, 2026-08-29

Ready for Plato's different review; **author evidence, not independent acceptance**.
No original H02/native/design result is rescored. This changes neither public
exports/default80 nor accepted Unit1/Unit2/shared runtime ownership contracts.

## Exact selected candidate

- Production source commit: `7a5c620005fb04518d44bb284f4e99284e4a7c33`.
- Baseline: source `6fde455bcc103117a6424b95156b152721f5735f`, computed tree
  `501ad98748e639c909f717007dac4f1da19c67dc`, package954 `4df8658746a881fd1316e403a234fd941baccfdead7a9518bc39fa7f6df2bb6e`.
- Successor computed tree: `74dfe69135a3fc5ba89396b20dd32d9c9daae131`.
- Full293-input `SOURCE-v4.json` SHA256:
  `4f196057df98c3aed05519b78eaa725fc9d7eb3c73634613662ac6b927715d32`.
- Only product overlay: `src/shell/conditional.ts`, blob
  `caab6172df5b8e5bad2d1db007b156f067e295ad`, 8890 bytes, SHA256
  `47dc81401b2c88f9e422fbce4b55734722aea594385d8b394eeba87df16928f0`.
- Full package: **954 members, 871045 bytes**, SHA256
  `46a845f6c12933308aef11dbbf8f861afcc38ff9973b83bcccea13c3329c0a09`.
- Preseal: `5ac8ddc2765ea6be703d56036b1a6fe6d335bc2b`.
- Corrected harness/preseal: `211b98e6da215308e8714a7a219bcd79bea3333a`;
  `run-v5.mjs` SHA256 `f05233239dc733d124b9c05bc209cf57d3732dafe2357770ac9a7811ef7749b4`.

This is an explicitly composed source view, **not current HEAD**. Mutable Node
module/root/package work never enters it. Existing authenticated source inputs,
ancestor/reconstructed tree witnesses, and the one stored overlay blob allow
recomputation without assuming the derived tree is a published Git object.

## Small product correction and profile

The production diff is one file, nine additions/nine removals:

1. Import existing `isFsError`; remove arbitrary object `.code` duck typing.
2. Reached `-v` aggregate selectors ending `[@]`/`[*]` refuse through the existing
   budgeted unsupported-profile path. Scalar/canonical numeric index behavior
   stays in runtime unchanged; no new arithmetic or array selection semantics.
3. Genuine typed ENOENT/ENOTDIR/EACCES/EPERM are false for metadata/access.
   Existing **typed access-only EROFS** false remains; metadata EROFS, ELOOP/EIO
   and untyped lookalikes propagate. Typed ENOTSUP/EOPNOTSUPP/ENOSYS remain reached
   status2 capability refusals. Caller, limits and sink/provider identities are
   not normalized to false.

No parser, runtime, contracts, limits, renderer, registry or package edits.
Native GNU errno/diagnostic equivalence is **not** established.

## Versioned H02: both actual ownership boundaries

`conditional-v4.mjs` preserves the old fixture separately in `conditional.mjs`.
No test-only API was added. `S01-registered` uses public `shell.commands.register`,
existing `CommandContext.registerCleanup`, and `context.invoke` of a shell function
whose body contains `[[ -f file ]]`.

All three layouts recorded these exact event orders:

- **H02-v4 unenrolled:** acquired → abort → public-rejected → test-release →
  provider-finalized. Before release: closed=false, exact caller reason=true.
  After explicit test release and awaited completion: closed=true.
- **S01 registered:** registered → acquired → cleanup-enter → test-release →
  provider-finalized → cleanup-finished → public-rejected. Before release:
  settled=false and closed=false; afterward both true, exact caller reason=true.

The test registers cleanup **before** invoking/acquiring work, owns the release
gate, releases in finally, and awaits provider completion. This demonstrates the
existing cooperative barrier, not a new implicit FS promise guarantee. All six
rows record one Shell created/disposed and no disposal rejection. These direct
observations belong only to the new controlled fixtures; old three H02 failures,
old closed=false and missing later-finalizer telemetry remain unchanged.

## Exact executed coverage

| Cohort | Source | Installed | Physically moved |
| --- | ---: | ---: | ---: |
| Versioned conditional50 +17 targeted identities | 67/67 | 67/67 | 67/67 |
| Unchanged resolved Unit2 author | 50/50 | 50/50 | 50/50 |
| Unchanged Unit1 redirections-v3 | 48/48 | 48/48 | 48/48 |
| Unchanged selected arrays | 12/12 | 12/12 | 12/12 |

**531/531 main identities**, plus3/3 restored controls separately. This includes
110 of the previous201 retained identities per layout; Git45/apply28/coherence18
(91/layout) were intentionally not rerun under this bounded repair. They are not
new passes. A27 changes only by removing the aggregate-presence conjunct; S02/S03
explicitly assert its new unsupported profile, while S04 proves skipped branches.
Original A27 and H02 fixtures/results remain immutable.

S05–S08 each exercise10 predicates against one typed errno; S09–S11 cover typed
capability refusal for metadata/access; S12–S14 distinguish plain objects and
ordinary Error instances with errno-looking fields; S15 preserves unclassified
typed errors/access-only EROFS; S16 proves an arbitrary code getter is not read;
S17 checks actual ShellLimitError and caller-priority identity.

- One strict production build passed; offline scripts-disabled full pack/install
  and actual physical move passed full member/content/mode checks.
- Six strict type groups passed, **24 expected negative diagnostics** (8/layout).
  These are public-root/type binding checks, not a global typecheck.
- Three actual loaded mutants were detected: aggregate acceptance, errno duck
  typing, and metadata denial escaping. Each original artifact was restored and
  its positive control passed. Full restored package inventory matched.
- Two actual loader binding refusals passed: missing and changed package input.
- Native Bash/oracles/engine/private/network execution: **zero**. Original40
  native reference cases, design gaps and Unit2's11 open IDs remain unrun/open.
  Deliberate unsupported-profile assertions are not GNU feature compatibility.

## Execution, retained failures and resource qualifications

The actual-grant origin remained `2026-08-29T06:06:58.185Z` for both versions.
V4 outer `/tmp/bash-conditional-launch-28iNV1` ran one runner that failed parsing
before product admission/execution: a generated qualification string replacement
left a suffix after a semicolon. Exit1/no signals/child closed; full1853-byte
transcription retained. V5 corrects that statement and versions dispatch/manifests;
source/caps/grant origin did not change. Three syntax-only checks then passed.

V5 ran `launch-v5.mjs --run` under pinned Node22.22.2, with its outer capture at
`/tmp/bash-conditional-launch-5syhIf` and selected work at
`/tmp/conditional-author-gq4Ndd`. Start06:08:19.106Z, terminal06:08:52.686Z;
exit0/no signals, 32975ms runner duration. No active tool session remains.

Recorded V5: **30 direct children,20 fixed internal-loader reservations,0 product
RegexWorkers**, all observed direct children closed, signals empty. Loader
reservations are not OS births. Previous failed runner, outer supervisors,
syntax/development/data helpers are separate; this is not a kernel-global census
or proof about arbitrary host promises. No native/private resource was acquired.
Runner capture3052781 bytes; scratch70139236 bytes. Caps remained30min/80ALL/peak4,
128MiB capture/768MiB work including publication; runner ceilings were lower.

A publication-only helper then misresolved the package basename relative to cwd
and exited ENOENT before publication. `publish-v6.mjs` uses the runner-declared
output root, verifies the same tarball hash, and includes it once in the capsule.
The failed `publish-v5.mjs` is retained, not claimed successful. This did not run
product/tests/build again or mutate the retained attempt. All old roots remain.

## Durable evidence and reviewer entry

`results-v5/RESULT.json` contains exact per-case rows, actual arguments/tools,
loaded bindings, types, mutants, full954-member package inventory and cleanup
receipt. `SUMMARY.json` exposes all six lifecycle event arrays. `RAW.json.gz`
contains131 top-level capture records,8729583 raw bytes/3864130 compressed,
SHA256 `7b6c1e3e704f475f8157c60d94dd9c90725d3ad407305c753ea8286ffcb7733d`.
Roundtrip hashes verified; `CAPTURE-INVENTORY.json` declares membership.
It includes both outer attempts and actual full tarball, not every duplicate
temporary tree. No AGENTS plaintext was materialized or archived.

Review source against6fde/501ad, then the exact two fixture deltas plus17 new
identities and the existing-contract registered path. Do not convert original
H02 or native/reference gaps into passes. Independent acceptance remains pending.
