# Independent atomic-empty extension: source-only checkpoint

Status: **source checkpoint complete; ready for service continuation, not API or
real-provider acceptance**. The independent verifier owns only this new subtree.
Production, contracts, exports, original tests and author evidence were not edited.
The user must RESUME this verifier after the author freezes actual-service evidence.
No service was started or distribution/dependency installed in this phase.

## Frozen inputs and reproducibility

Candidate: `d1174e2db9f4a4c92403842dee6fb3d4ff57ec96`.
Approved predecessor: `e9daab5722c682377cc59abec099648e3692c6ec`.
Freeze recorded at `2026-08-27T08:18:32.022Z`; source-only validation finished
before `2026-08-27T08:23:50Z`. This is actual checkpoint work, not a 72-hour claim.

`evidence/freeze/manifest.json` records complete per-file SHA256s for both archives,
their exact git revisions, selected paths and the dirty shared worktree observation.
The archives are committed git inputs, not a copy of live production source.

| Artifact | SHA256 |
| --- | --- |
| Candidate source/package/original-test archive | `0bbfbebaa2f61174db0617059a97f59091524207e36ccc53eb33c787edfc790b` |
| Predecessor source/package/proposal archive | `f22eb26f554c4eaebb99d6cf6a8a3f23c9ebda675e888889041b63460f9e4a78` |
| Candidate `src/fs/webdav/webdav.ts` | `e66a66e2745852c6bd12be12a18c855df069152cf6b8089d2ecee8880c62de94` |
| Candidate and extracted `package.json` | `c9b768b3ec77ac19262a36ce46f331618916fd7746492d83f0bf6e1212999360` |
| Final built/extracted package tarball | `78461169565ceb3da674d881bf983b7a50832cd57fb7ff1bbaf68db43c46b937` |

Run from the repository root:

```sh
node tests/fs/webdav/atomic-extension-independent/verify.mjs unique-cohort-name
```

The runner verifies all 237 candidate archive inputs before execution, overlays
only its own independent test, and uses owned temporary directories for tests,
build output, npm cache, package extraction and the consumer. Shared `dist` is
never used or written. It reads existing development tools without installing
them: Node `v22.22.2`, Darwin arm64, TypeScript `5.9.3`, tsx `4.23.12`, Node types
`22.20.1`. Tool manifest hashes and exact commands are retained. There is no
performance conclusion; concurrent owners were working on this host.

`freeze.mjs` is a capture recipe, not a rerun prerequisite. Do not overwrite the
immutable freeze. `primary.mjs` fetched six primary tagged source texts only;
it did not fetch a WsgiDAV wheel or install/start a service. The tagged text
hashes are not proof that a future installed wheel executes the same bytes.

## Results

Final cohort: `evidence/final/commands.json`.

| Separate cohort | Result |
| --- | --- |
| Independent hidden source regressions | 46/46 |
| Original author callback tests, unchanged | 33/33 |
| Original top-level WebDAV suites, unchanged | 568/568 |
| Original legacy LOCK grants | 23/23 |
| Original direct comparison authority | 23/23 |
| Original timestamp postcondition | 5/5 |
| Original recognized lock scopes | 28/28 |
| Original mount/overlay alias guards | 49/49 |
| Strict scoped source/test types | exit 0 |
| Complete frozen-source ESM/declaration build | exit 0 |
| npm pack, separate-consumer types and runtime | exit 0 each |

These are 775 scoped runtime tests, not a complete repository gate or a provider
matrix. The original **78/79 stock profile stays 78/79**, with its original inputs
and failures intact. No original provider cohort was rerun, relabeled or greened.

The staged whitespace check flags nine context-only space lines in the verbatim
`evidence/freeze/source.diff`. They are preserved as captured diff bytes, not
stripped to make the check green. The scoped check excluding only that raw diff
passes; independent source, documentation and other retained artifacts are checked.

The first cohort passed 40 independent tests and the same original runtime cohorts,
but my test and consumer accessed an intentionally absent property through the
adapter's concrete inferred capability type. Both compiles failed with TS2339.
The correction views capabilities through public `FileSystem`, still asserting
that `snapshotRmdir` is not true. This is a verifier type error, not a source
failure or weakened runtime assertion. `evidence/first` retains exact inputs,
hashes, commands and failed diagnostics; `evidence/qualified` retains the 40-test
corrected run. Six additional alias/metadata/concurrent-cancellation holdouts
produce the final 46-test cohort. No failing candidate behavior was suppressed.

## Source findings

**No concrete candidate source defect was reproduced in this phase.** This is
bounded by these tests and the trusted-host contract, not proof of safe arbitrary
callbacks, all configuration combinations, or deployed provider correctness.

The production delta is exactly three WebDAV-owned files: `webdav.ts`, its
subpath barrel and its README. `evidence/freeze/source.diff` preserves it.
Contracts, root exports, package and lockfile do not change. The predecessor
proposal's operation/namespace/path/receipt shape matches the implemented public
types. It was a synthetic feasibility fixture, not WsgiDAV integration proof.

- Construction compares the binding to the configured URL's canonical spelling
  before dispatch and captures the callback/namespace. Ordinary different URL,
  scheme, default-port spelling, encoding, trailing slash and query/fragment
  mismatches reject without metadata or callback effects. A canonical binding
  can match a safely canonicalized configured base URL.
- `rmdir` normalizes, checks cancellation/root, observes type, then dispatches.
  The callback gets a frozen canonical request. Literal percent sequences are
  not accidentally decoded into path separators. Invalid text, files, root and
  failed metadata cannot reach the callback. Metadata is not a lease: the host
  must enforce removal-time type, final-symlink rejection and emptiness itself.
- Configured nonempty observations deliberately reach the host's native decision,
  without a snapshot listing. Typed/native/untyped/synchronous failures preserve
  public `rmdir` syscall and original caller path with causes as applicable.
  Signal and timeout races reject promptly; late resolution and rejection remain
  observed. Independent invocations do not share caller cancellation state.
- Exact receipts are required. Mismatch after a completed effect is uncertain EIO;
  native/transport failures and cancellation can also follow completed effects.
  No callback retry, recursive fallback, recreation or rollback occurs.
- Stock omission remains read-only ENOTSUP for an empty collection. Configured and
  stock capabilities do not advertise snapshot removal or atomic rename. The
  change adds no COPY/MOVE lock grant parsing or permission relaxation; unchanged
  legacy scope/grant tests and new configured alias/unknown guards remain green.
- Distinct binding objects and canonical URL aliases do not themselves assert
  disjoint storage. The independent alias transport faithfully rewrites hrefs,
  deliberately drops response provenance when remapping, and either retains a
  truthful shared DAV resource identifier (same) or omits it (unknown). Neither
  case becomes distinct merely because the configured namespace differs. This
  fixture is not evidence of a real provider's alias/lock-root canonicalization.

## Public package proof

The build is from the archive, followed by actual `npm pack --ignore-scripts` and
extraction into `consumer/node_modules/virtual-bash`. The consumer's separate
`package.json` has name `atomic-extension-independent-consumer`, defeating package
self-reference. Both root and WebDAV subpath types compile and runtime constructors
are identical. Runtime checks exercise public configured removal and stock refusal.

`evidence/final/loaded.jsonl` records hashes of **157 modules actually loaded** by
Node's ESM loader. `loaded-verification.json` confirms every loaded source matches
both the isolated build and extracted package bytes. Runtime output records the
resolved root/subpath URLs, real paths and hashes. The tarball remains available;
the temporary extracted paths are intentionally removed and recorded in cleanup.
This metadata transport is not a real HTTP/provider integration test.

## Service continuation boundary

See `SERVICE-HOLDOUTS.md` for pinned call order, the actual lock serialization
question and concrete next-phase holdouts. Author files copied into
`evidence/freeze/author-observed-*.txt` were read-only **dirty observations** at
capture time; they are not the author's frozen service evidence or an approval.
No in-progress author service harness was executed or modified.

Phase 1 stops here. Real authentication, actual lock mutations vs native removal,
probe negatives, deployment mapping and aliased backing/provider behavior still
require the separately authorized pinned-service replay. No blanket API acceptance,
real-service support, universal parity, superiority or full completion is claimed.
