# ship-csvcut packed export verification

## Markdown QA

Verify the live working candidate, preserving unrelated edits. The requested
package pattern is at [its archived location](archive/safe-bash-command-package-pattern.md)
following an existing move. This task documents and verifies the existing
candidate; it does not certify full csvkit compatibility or publish a package.

1. Inspect command manifest, public entry, command/behavior/engine ownership,
   versioned profiles and independent control tests. Confirm private ESM,
   no external runtime dependencies, opt-in registration and VFS-only I/O.
   Do not access held XAN sources or run native executables as unit dependencies.
2. Run maintained csvcut and shared CSV engine unit routes, csvcut lint/typecheck,
   and selected safe-bash workspace build closure. Inspect grammar, exact
   selectors/open ranges, bytes/chunks, error, cancellation, quotas and cleanup
   coverage without extrapolating to unsupported upstream behavior.
3. Stage public artifacts with `scripts/package-safe.mjs` under task-owned
   `/out/ship-csvcut`; npm-pack public SafeFS/SafeJS/SafeBash with scripts disabled.
   If `/out` is read-only, use ignored repository `out/ship-csvcut` and record it.
4. Install only public tarballs offline with scripts disabled into a fresh
   consumer. Inspect installed manifests/lock and confirm no private command,
   engine or contracts workspace is installed. Deny file imports outside the
   consumer with a Node loader.
5. Execute the maintained private-command fixture, including csvcut CLI/SDK
   parity, brands, byte ownership, missing paths, quotas and projection. Run
   default/browser/workerd Node condition cells. Compile the maintained csvcut
   consumer with strict ES2023 NodeNext, unchecked indexed access and exact
   optional properties; no skipLibCheck. Audit resolved declaration ownership.
6. Audit shipped JavaScript/declaration module specifiers structurally for
   unpublished workspace leaks and relative declaration closure. Bundle the
   installed fixture for browser/workerd conditions and run in fresh web-API VM
   realms without Buffer/process/require. These are graph/realm checks, not
   execution in actual browser/workerd engines.
7. Review exact flag/limit/output/runtime README claims and execute both examples
   against installed exports. Update only safe-bash's existing usage/support
   sections. Inspect adhoc CLI screenshots if visible output changes, and
   generated-document screenshots if rendering changes; do not invent screenshot
   tests or claim unexecuted rendering/engine qualification.
8. Record results and limits here, then purge task-owned temporary artifacts.
   Report local verification separately from commits, remote-main and release.

## Executed results, 2026-09-20

Verified the dirty working candidate based on HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, not an archive of that commit.
No production defect was validated or runtime repair made. Updated the compact
csvcut README with exact flags, examples, output/error contracts, default quotas,
versioned limitations and lifecycle ownership. Replaced safe-bash's stale
engine-only usage sentence and updated its existing support row. Unrelated
changes, including the package-pattern move, were preserved.

Ownership remains `packages/safe-bash-command-csvcut`, manifest name
`safe-bash-command-csvcut`, `private: true`, ESM and empty runtime dependencies.
Shared CSV logic resides in the private CSV engine; safe-bash's entry is a static
workspace re-export. Registration remains opt-in. Inspected production sources
contain no host, network, dynamic dependency or native/WASM fallback. Arbitrary
caller capabilities are not sandboxed by this adapter; VFS confinement belongs
to the supplied filesystem.

- `npm run test:unit --workspace=safe-bash-command-csvcut`: 116 passed,
  zero failures/skips. Existing independent CLI/SDK controls cover names,
  duplicate/numeric/exact headers, open ranges/zero, generated names, short and
  excess rows, deletion, quoting/encoding rejection, errors and every byte split.
  Other tests cover argument grammar, invalid UTF-8 argv, output/input/retention
  limits, falsey cancellation, cooperative pending reads, idempotent cleanup,
  producer retirement and ownership. Tests use memory/mocked capabilities.
- `npm run test:unit --workspace=safe-bash-csv-engine`: 24 passed,
  zero failures/skips. These include strict/permissive distinctions, multiline
  physical positions, resource axes, selector rules and terminal ledgers.
- `npm run lint --workspace=safe-bash-command-csvcut` and
  `npm run lint --workspace=safe-bash-csv-engine`: ESLint and both package
  typecheck configurations passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: selected
  maintained dependency closure passed, including safe-bash native postbuild.
  The runner declared 22 builds; it used the shared machine cache.
- Public staging version `0.0.0-ship-csvcut` and packing passed using that build.
  Only public SafeFS/SafeJS/SafeBash tarballs were packed, with scripts disabled.
  Fresh offline installation passed; lock inspection found no private command,
  CSV engine or contracts workspace installed. Public artifact dependencies
  remain distinct from the command's empty external runtime dependencies.
- Installed csvcut targets:
  `./dist/safe-bash/commands/csvcut/index.js` and
  `./dist/safe-bash/commands/csvcut/index.d.ts`. Maintained private-command fixture
  passed under default/browser/workerd Node conditions with a loader denying
  all outside-consumer file imports. Browser/workerd cells initialized Node's
  web APIs before removing global Buffer. Canonical runtime/error/argument/value
  identities, raw byte ownership, opt-in registration and CLI/SDK parity passed.
- Maintained `safe-packages-csvcut-types.mts` passed strict ES2023 NodeNext,
  exact optional properties and unchecked indexed access in all three condition
  cells, without skipLibCheck. Compiler resolution admitted only the consumer
  and TypeScript's standard library; each program used 240 source files.
  The consumer supplied its own offline-installed `@types/node` development
  dependency and restricted type roots, with no private workspace types.
- Structural shipped-specifier audit: 1,298 JavaScript/declaration files,
  3,641 module references, no bare private command/CSV engine/contracts imports.
  Strict isolated type programs verified declaration closure.
- Installed fixture browser-platform bundles passed in separate VM realms for
  browser and workerd conditions. Bundle input ownership remained inside the
  consumer. Explicit web capabilities were supplied, with a TextEncoder adapter
  returning realm-owned Uint8Array values; Buffer/process/require were absent.
- Both README examples passed against installed exports. Additional independent
  literal controls passed 183 byte-split cells across 14 cases, including
  duplicate/blank/exact names, numeric positions, short/excess rows, projection
  deletion, zero columns, unknown exclusions, names, tabs override, physical
  skip, empty input, CRLF conversion, open/zero ranges and emitted numbering of
  multiline rows. Each retired its input once. Falsey cancellation reasons and
  output-quota rejection before ordinary emission also passed.
- Scoped diff whitespace checks passed. No code/shared infrastructure changed;
  full repository unit/lint routes were not run for this documentation audit.

Setup failures are separate from those passes: initial unrestricted compiler
resolution picked up the checkout's `buffer` declarations. Removing all Node
types then exposed safe-fs's Node crypto declaration requirement. Supplying local
Node development types and denying outside-consumer compiler reads produced the
passing isolated programs. The first VM fixture failed because host TextEncoder
returned foreign Uint8Array values to the canonical transport; adapting the
explicit encoder capability to the VM's byte realm corrected the harness.
No product assertion, quota, timeout or runtime was changed to obtain a pass.

Tarball SHA256:

- SafeBash: `68bb64a9f2f8fe85c959f766ebe629a7f0a2dfdb68a7da4fac35d3ec71f3d373`
- SafeFS: `aaef80b72ebb10fdfa536f4ce54f899028c5c2e9361f65314ae2913b94b568f9`
- SafeJS: `e8c9e52e35948d351fef1f71d0e39c28bde09d53ca03ecb721dd62e216485e83`

The compatibility identity remains csvkit 2.2.0 / agate 1.14.2 / Python 3.9,
separate from pinned later source csvkit
`194c904256a09dc203c460944d35e9d414244503` and agate
`34856488cfcbe9077af8e3e557cbf98a044fdd64`. No native executable or held XAN
source was used. No Sniffer, additional codecs, quoting 1/2 or later-source
`--ignore-unknown-columns` was admitted. Strict CSV is a documented isolation
deviation; permissive-v1 NUL/EOF and ASCII selectors remain candidate profiles.
Full versioned grammar/error/codec compatibility is not claimed. The broader
[acceptance matrix](safe-bash-csvcut-acceptance.md) remains open.

Actual browser/workerd engines and checkpoint/replay command execution were not
qualified by these graph/realm checks. No visible CLI output or document renderer
changed, so adhoc CLI and generated-document screenshots were not applicable to
this documentation-only change; document rendering was not qualified.

`/out` creation failed because the filesystem is read-only. Task-owned logs,
staging, tarballs and consumer used ignored repository `out/ship-csvcut` and were
purged after inspection. Local commits: none. Verified remote-main delivery:
none. Successful releases: none. Neither the private workspace nor any public
artifact was published.

## Independent final revalidation, 2026-09-20

Re-executed the Markdown QA against the current working tree at the same HEAD
using Node 22.22.2 and TypeScript 5.9.3. Preserved all existing implementation,
fixtures and unrelated edits. Added runtime qualification limits to the package
README and safe-bash's existing usage section. No production defect was validated;
no code or shared build infrastructure changed.

- Maintained csvcut units: 116 passed; shared CSV engine units: 24 passed.
  Both workspace lint/source-and-test typechecks passed.
- Selected maintained safe-bash build closure and native postbuild passed:
  22 declared builds, shared cache enabled. Full repository routes were not
  required for these documentation changes.
- Public staging/packing at `0.0.0-ship-csvcut-review` and fresh offline
  installation passed. Only public runtime packages and consumer development
  Node types were packed; no private command, CSV engine or contracts package
  was installed. The loader denied file imports outside the consumer.
- Maintained private-command fixture passed default/browser/workerd conditions;
  browser/workerd ran without global Buffer. Strict isolated declarations passed
  all three conditions, with 240 files each and no skipLibCheck. Compiler reads
  were restricted to consumer files and TypeScript standard libraries.
- Structural audit checked 1,814 shipped JS/declaration files and 5,234 module
  references with zero bare private command/engine/contracts leaks.
- Browser-platform bundles passed browser/workerd conditions in fresh VM realms,
  99 consumer-owned inputs each, without Buffer/process/require. Explicit web
  capabilities included realm-owned encoder bytes and decoder TypeErrors.
- Both exact README examples ran against the installed subpath and produced the
  documented output. Review found no task-scope unresolved defect or justified
  simplification in abstraction, host access, failure, cancellation, budget,
  ownership or version/profile handling.

Harness setup failures were resolved without product changes: the default Node
entry needs Node's Buffer; removing it applies only to browser/workerd cells.
Node web APIs were initialized before removing Buffer. VM setup needed explicit
performance and encoding capabilities; host decoder errors required realm-owned
TypeErrors to preserve normal platform exception identity. These harness failures
are not passing runtime cells. Actual browser/workerd engines, checkpoint/replay
and full upstream compatibility remain unqualified as documented above.

Tarball SHA256 for this run:

- SafeBash: `067230b0adf17b14be1085c39280cb982e32b59fd4bf1a8efd5c989ce347995f`
- SafeFS: `930accb1f0a6ec839eee68768fc48e0d8e5134376c161d31a01238618e941a04`
- SafeJS: `6a148d0ea07e4d05318b5bc4ea08fa46f0967ac0952f3f2bd1330c13b2e89bb1`

No CLI output or document renderer changed, so screenshots were not applicable.
`/out` remained read-only; ignored task-owned `out/ship-csvcut-review` artifacts
were purged after inspection. Local commits, verified remote-main delivery and
successful releases: none. Nothing was published.

## Packed candidate revalidation, 2026-09-20

Executed the Markdown QA again against the dirty working candidate based on
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, using Node 22.22.2 and TypeScript
5.9.3. This run adds the exact informational version output to the package README
and clarifies that csvkit 2.2.0 / agate 1.14.2 is a compatibility target. Existing
safe-bash usage/support documentation already describes this candidate accurately.
No runtime defect was validated and no production code was changed.

Passed:

- Maintained csvcut and shared CSV engine `test:unit` routes; engine reports 24
  passing tests. Both workspace lint/source-and-test typechecks passed.
- Selected maintained safe-bash workspace build closure and postbuild: 22 builds,
  shared cache enabled. Supplementary csvcut Shell wiring, boundary and independent
  control files: 7 passed, zero failed, skipped, cancelled or TODO.
- Public staging, npm packing with scripts disabled and fresh offline consumer
  installation at `0.0.0-ship-csvcut-final`. Installed lock contains no private
  command, CSV engine or contracts workspace. The public packages retain their
  own admitted dependencies; the command manifest has no runtime dependencies.
- Maintained private-command fixture under default/browser/workerd conditions,
  with a loader rejecting imports outside the installed consumer. Browser/workerd
  condition cells ran without global Buffer.
- Strict isolated csvcut declarations under all three conditions: 240 files each,
  no skipLibCheck, unchecked indexed access and exact optional properties enabled.
  Compiler file reads were restricted to consumer files and TypeScript libraries.
- Structural audit of safe-bash's installed artifact: 1,298 JS/declaration files,
  3,638 module references, zero bare private imports and complete relative
  declaration references.
- Browser-platform browser/workerd bundles: 99 consumer-owned inputs each.
  Both fixtures passed in fresh VM realms without Buffer/process/require, using
  explicit web capabilities and realm-owned encoder bytes/decoder TypeErrors.
- Both README examples and exact `--version` output passed against installed
  exports. Additional literal controls passed 76 byte-split cells covering numeric
  positions, repeated projection, short/excess rows, post-projection deletion,
  zero columns, CRLF conversion, open zero-origin ranges and empty input. Four
  selector/names negative controls and five cancellation-reason controls passed;
  each completed input retired exactly once, and pre-aborted input was not acquired.

Harness setup failures: copying Node development types found they were already
installed; the subsequent fixture-copy command used the consumer as its source
root and failed before execution. Correcting these setup paths required no product
change. The first compiler host rejected attempted resolution of checkout-owned
`buffer` metadata. Denying outside-consumer existence queries as well as reads
produced the isolated declaration passes. These failed setup attempts are separate
from the completed gates; no timeout or product assertion failed.

Scoped source SHA256 is
`6e0b7300fc66d5af8b7f59c956113f7df58f05d64c1df1ffabc1e20066f7b6d7`.
Reproduce by sorting/deduplicating `git ls-files -co --exclude-standard --` for
root package.json/package-lock.json; csvcut, CSV engine and contracts workspaces;
safe-bash src/package.json; safe-fs src/package.json; and
scripts/{package-safe,bundle-safe-bash,safe-command-publication}.mjs.
Hash each existing file as UTF-8 repository-relative path, NUL, raw contents, NUL
in that order (818 listed entries). This identifies the scoped working sources;
the following hashes identify the complete packed public artifacts:

- SafeBash: `91bf79dc9ac3846f89397471ecfecb4b26b5531a249ef29cb1e18fc5dfd6bee7`
- SafeFS: `ef5f846cfa34d431490857e29c5ea699e6e9e221309a2d0fbd126acba17e1f1a`
- SafeJS: `ed0032f5c9a7f547051e8744e582b743ff3c1781293fa6acba8838d7cdf46872`

Unverified: actual browser/workerd engines, checkpoint/replay, native executable
comparison, full upstream grammar/error/codec compatibility and bounded performance
measurements. Unsupported capabilities remain as documented: Sniffer, extra codecs,
quoting 1/2 and later-source `--ignore-unknown-columns`. No held XAN source was used.
Full repository unit/lint/build gates were not run for this documentation-only
change; the selected build is not a completed repository-wide gate. No visible
CLI or renderer changed, so adhoc CLI/document screenshots were not applicable.

`/out` creation failed because it is read-only. Task-owned ignored
`out/ship-csvcut-final` staging, archives, consumer and logs were removed after
inspection. Local commits: none. Verified remote-main delivery: none. Successful
releases: none. No private package or public artifact was published.
