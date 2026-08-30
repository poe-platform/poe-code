# Faithful S3 filesystem decorator followup

August 27, 2026. Bounded implementation under the existing approved `cd8b5c8`
trusted-host binding rule and explicit filesystem-decorator followup instruction.
The accepted `91d5926` original S3 16/16 checkpoint and all its evidence remain
unchanged. Only S3 source/backend tests and this new evidence directory are owned.
No Memory, WebDAV, core, contracts, root exports, dependencies or Dirac-owned
`tests/fs/authority-trust-review/**` files are changed.

## Confirmed valid refusal and fix

The exact `filesystem.readFile = filesystem.readFile.bind(filesystem)` input
changed only a function reference. Nevertheless, fresh comparison returned
unknown and existing-target copy failed ENOTSUP. Original source bytes
`[0,255,128,10,17]` survived, but target `[7,0,8]` was not copied. Buffered/streamed
forwarders, bound streams, metadata forwarders and a faithful buffering subclass
reproduced the same false refusal: six failures in nine new tests, with all three
actual transport/bucket/prefix-routing guards passing.

The two-file product patch removes only filesystem function-reference eligibility:
the per-instance method array and all-original-base-method predicate. The original
compareEntry function reference remains exclusively for dynamic explicit dispatch.
Actual transport/bucket/prefix configuration, provider Map/key, fresh query proof,
exact metadata/stat objects and filesystem/path binding remain. No fresh namespace
token, implicit cross-provider disjointness or public API is introduced. Native
copy/rename conditions, partial-error handling and nonatomic/ABA limits are unchanged.

The SAME nine-test fixture (SHA256
`4e6e0cf6f8db8b865f538960c54f5df5fa8b12974423012e74d4358f4bdcf268`)
passes 9/9 after the source patch. Six legitimate decorator cases now compare
distinct and actually copy the existing target while preserving the source. They
also prove same-key aliases, reject alias copy with EINVAL and exclusive overwrite
with EEXIST, and verify no content/mutation requests during those guards. Three
configuration-substitution cases continue rejecting the old stat binding.

## Preserved violation records and explicit classification

`before.json` records old authority82/82, decorators3/9 and original S3 16/16.
`source-only.json` runs the OLD authority assertions after the source patch:
authority71/82, decorators9/9 and original S3 16/16. All11 old-profile failures are
retained before any test classification. Exact original test files also remain in
`old-adapter-overrides.source.txt` and `old-comparison.source.txt` with snapshots
inside the captures. `classification.json` maps every old/new case ID.

Ten cases deliberately redirect data methods to a local Memory source while
inheriting unrelated Mock metadata authority (eight subclass/prototype/instance
buffer/stream combinations and two Memory-consumer cases). That falsely retained
binding violates the approved host contract. In the source-only raw records the
eight paired cases report distinct, invoke the redirected methods, change the
local source to `[68,65,77,65,71,69]` (DAMAGE), and throw EIO. These are actual
host-induced effects, preserved explicitly, NOT compliant-provider successes.

The revised ten active cases now omit the false inherited assertion by returning
a copied stat. Their expected unknown/ENOTSUP, exact source/provider/sentinel bytes,
namespace and zero-data-effect assertions are unchanged. They test the legitimate
remapping obligation rather than claim protection against a lying host callback.

The eleventh case installed a cache returning the exact old marked stat object.
Its old assertion rejected the changed method reference, not the object's age.
With that gate removed, a host must not misrepresent this old observation as fresh.
The revised cache drops the stale private binding by returning a copied stat;
unknown is preserved. Wrong-path and copied-stat assertions remain, and wrong-FS
binding is now checked explicitly. Unchanged stale/wrong-key/copied/manufactured
HEAD-query tests still pass. The private synchronous descriptor is point-in-time
evidence, not an age/lease oracle or sandbox for host replay of marked objects.

All original test cases remain active under their documented compliant input
classification; no skip, TODO or passing-violation substitution is used. The
three other adapter tests, seven trusted-forwarding tests and all33 late-explicit
tests are unchanged. Late EACCES, invalid/conflicting answers, cancellation,
complete-ID precedence, readonly and legitimate alias protections remain required.

## Final scoped replay

`final.json` records:

| Cohort | Result |
| --- | --- |
| Faithful decorator + actual-routing regressions | 9/9 |
| Existing authority/comparison/late-error/trusted-forwarding tests | 82/82 |
| Unchanged original S3 compatibility subset | 16/16 |
| All S3 backend tests | 270/270 |
| Independent policy86, read-only | 86/86 |
| S3 conformance + provenance | 50+2 / 52 |
| Strict S3 source/backend-test types | exit0 |

The 9 and 82 are included in backend270, not additional disjoint totals. All final
test cohorts have zero failures, cancellations, skips and TODOs. The original
fixture remains SHA256
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
No whole original38 combined result is claimed; Dirac's independent gate remains
separate. Generic SDK/copied-metadata identity remains an open requirement.

Baseline HEAD is `0e1448ff4b9dcbedc06dfb1a654f649eef0bb9eb`; final snapshot HEAD is
`20b889b943eceb66cc396c1a615c6789898962fe` plus this recorded owned patch. All three
captures contain exact inputs, raw commands/output, source snapshots, worktree
state and zero changed inputs during their commands. Core `0bee8e7` is an ancestor.
Concurrent Memory/WebDAV work is recorded, not edited or claimed as this commit.

| Source | Before SHA256 | Final SHA256 |
| --- | --- | --- |
| authority.ts | `78fb41e8a54de13a1b3114051c71949cbb2830a9508e1d6cd5b75515c6d0d29f` | `a89587089b0d059d44393e04822ff8f3481faa0aedb8101449d087100f8e30a8` |
| filesystem.ts | `45cec66e7569e93076e0476e9e8e743644283cf9bc89193f3801a0e5fb790dba` | `b34d766829184cf73ff6e8712d0bcb60216c35250234a0b80475f8d91d4f1a9e` |

Use `node tests/fs/s3/faithful-decorators/validate.mjs replay-unique-label` for a
new capture; existing artifacts cannot be overwritten. `SHA256SUMS` seals the
new evidence and final owned files. Old `d25cb3f`, safety, late-authority and
`91d5926` trusted-observation evidence remain byte-identical. No active validation
processes remain at this checkpoint.
