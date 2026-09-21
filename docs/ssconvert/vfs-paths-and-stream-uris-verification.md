# VFS paths and stream URIs verification

Implemented the shared injected `createResourceIO` API in
`packages/ssconvert/src/io`, exported through the existing ssconvert SDK. The
opt-in Safe Bash command named exactly `ssconvert` uses it with the invocation's
VFS, cwd, stdin, stdout and cancellation. No native product dependency, ambient
host filesystem/network access, README edit, commit, push or publication occurred.
Existing edits were preserved.

## Reference and behavior

The task-owned official Gnumeric 1.12.61 download matched SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
GOffice 0.10.61 matched
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.
Unchanged source was built in a separate Debian aarch64 oracle container, with
only task scratch mounted. Its binary SHA-256 was
`d7b57fbb10a99097326d381f6e8c6ab9150092fca78cd03d7f41e5c968d64e82`.
This supplementary build has its own identity; it is not the earlier binary.
Runtime dependencies were GOffice 0.10.61, GLib 2.84.4, GTK 3.24.49 and libgsf
1.14.53, with C locale and UTC. The accompanying
[profile](vfs-paths-and-stream-uris-profile.json) captures installed package
versions, plugin-manifest hashes, actual service listings, environment, original
and corrected observations, comparison results and candidate source hashes.

- Relative/absolute filenames resolve within the injected POSIX VFS. Literal
  `-` is a filename for input and output; it never selects stdin.
- File URI conversion follows measured GIO escaping, including Unicode and
  reserved path characters. File authority is ignored, including foreign
  authority; credentials/ports are rejected. Query/fragment suffixes are stripped.
  Literal/encoded backslashes retain POSIX filename identity. Encoded slash, NUL,
  invalid escapes and relative file URIs fail before VFS access.
- FD names are case-insensitive decimal values through INT_MAX, with an optional
  trailing slash and leading zeros. The command binds 0/1 to invocation stdin/
  stdout; other descriptors require explicit `io.descriptors` bindings. Repeated
  reads share a consumptive cursor, without replaying stdin. Unbound descriptors
  reproduce measured native read/write diagnostics.
- Registered scheme adapters are explicit host capabilities. HTTP(S) transport
  requires explicit binding, authorization before each request and each redirect,
  a redirect limit and cancellation. Credential-bearing or non-HTTP redirects
  are denied before dispatch. Transport must perform only the authorized request,
  follow no redirects internally and use no ambient credentials. Unknown schemes
  reproduce the measured no-handler failure.
- Retained chunks are copied by the actual engine before advancing producers.
  Sink writes are awaited. Descriptor iterators are acquired lazily; borrowed
  descriptors remain host/shell-owned. Owned source iteration closes normally or
  on cancellation. Codec input/output remains bounded materialized bytes; this
  work does not pretend ZIP/random-access conversion is incremental streaming.

For SDK filename/URI behavior, bind the same adapter to `createEngine`:

```ts
const filesystem = createResourceIO({
  cwd: "/work",
  filesystem: vfs,
  descriptors: { 0: { source: stdin }, 1: { sink: stdout } }
});
const engine = createEngine({ ...config, filesystem });
await runCommand(args, engine, { signal, stdout, stderr });
```

`vfs` implements the injected byte `FileSystem` interface using POSIX paths.
The existing raw engine filesystem contract remains available for hosts that
already interpret their own resource identities.

## Verified scope

Executed [QA procedure](../plans/ssconvert-vfs-paths-and-stream-uris-qa.md).
The first original memfs case failed before implementation. Later failing cases
validated empty-descriptor basename and GIO escaping repairs. A different agent
independently found and repaired eager acquisition, consumption cancellation,
URI validation and backslash handling with failing regressions.

- Maintained uncached selected Safe Bash workspace build closure: passed, including
  the ssconvert dependency and optional CLI build stage.
- `npm run test:unit --workspace=@poe-code/ssconvert -- --no-cache`: 349 tests passed
  across 24 files. Domain lint, source typecheck and test typecheck passed through
  `npm run lint --workspace=@poe-code/ssconvert`.
- Uncached selected Safe Bash command tests: 18 passed. Focused Safe Bash ESLint
  passed. Cases cover memfs/mounted VFS publication, binary output, piped/implicit
  empty stdin, unchanged source namespaces and shared command/SDK dispatch.
- IO differential: 35 exact status/stdout/stderr matches; explicit descriptor
  output also matched publication bytes. These used an original passthrough
  fixture codec to isolate IO, and do not qualify production CSV/format fidelity.
- Two original native fd3 cases remain unmeasured because the runtime owned that
  descriptor without an explicit comparable binding. Separate explicitly inherited
  fd3 cases passed. No original observations were rewritten as passes.
- One measured safety divergence: native owned-loopback HTTP access succeeded;
  product access with no transport binding failed with capability-disabled status
  and diagnostic. This is excluded from equivalence passes.
- Actual SDK output was rendered with the maintained terminal PNG renderer and
  inspected visually: escaped URI invocation, fixture output and no-handler
  diagnostic were legible. Screenshot hash is retained in the profile; temporary
  raster output is purged. No screenshot tests were added.

## Remaining limits and failed checks

`npm run typecheck --workspace=@poe-platform/safe-bash` failed before compilation
at its public SafeFS/SafeJS identity preflight. A separate exploratory direct
compiler run also failed across broader source/tests, including retained DOM
listener types in the existing ssconvert test helper. Neither is reported as a
passing maintained gate; compressed exact diagnostics are retained in the profile.
No assertions, timeouts, supported versions or broader declarations were weakened.

Never-consumed ByteSource acquisitions have no generic disposal hook in the
existing interface. Transport request/redirect resources remain host-owned.
Uncooperative host work is not forcibly preempted. Real remote-service/adaptor
interoperability, enabled FTP profiles, non-UTF-8 encoded filenames, symlink and
namespace races, injected descriptor read/close failures, performance and replay
remain unmeasured. No full format, release, realm-isolation or replay guarantee is
claimed. The initial missing-schema noisy oracle capture is preserved separately
from the corrected profile and contributes no equivalence passes.

## Verified configuration/redirect follow-up (2026-09-19)

The implementation was already present at the start of this follow-up. Existing
source and reference observations were preserved. Three original failures were
reproduced before repairs: replacing the configuration's cwd/filesystem changed
the admitted namespace; replacing a transport request hook during authorization
changed the dispatched capability; malformed redirect locations escaped as raw
`TypeError`. The IO binding now retains its cwd/filesystem references and bound
transport hooks/redirect limit. Invalid redirect locations produce exit-1
`SsconvertError` with `invalid-request` and `Invalid remote URI`. Host capability
implementation internals remain trusted; this is not host object isolation.

A different agent independently authored eight original authority, redirect,
cancellation, write-denial and awaited iterator-cleanup cases. It reproduced the
last two failures and repaired redirect validation; root retained integration,
export and Git ownership and repaired capability snapshots. All 22 IO cases
passed on the exact final source candidate. Redirect-bound mutation was a passing
negative control, not an independently reproduced failure.

Fresh checks on this candidate:

- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  passed the declared selected closure (18 workspace builds) and optional CLI
  stage, including ssconvert. This is not a full repository build.
- `npm run test:unit --workspace=@poe-code/ssconvert -- --no-cache`: 358 passed,
  26 files, no failed/skipped tests. Domain lint, source and test typechecking
  passed via `npm run lint --workspace=@poe-code/ssconvert`.
- Selected Safe Bash ssconvert node:test route: 18 passed, zero failures/skips.
  Focused adapter/integration ESLint passed. Existing cases exercised mounted
  binary output, stdin provenance, input budgets, failure cleanup and namespace
  preservation through actual shell/SDK dispatch.
- Manual built SDK/virtual-command QA passed for literal dash, binary output,
  escaped file URI with foreign authority, empty stdin, encoded-separator denial
  and disabled remote access with zero destination effects. Original fixture
  codecs isolate IO; these are not production-format equivalence passes.
- Cross-realm bytes reached an explicitly injected byte host and preserved all
  four byte values. The host copied into local bytes before MemoryFileSystem
  publication. Direct MemoryFileSystem submission of a foreign-realm Uint8Array
  rejected with `Memory files require Uint8Array data`; that boundary is not a
  cross-realm interoperability pass and was not changed here. An initial manual
  fixture also used an unsupported MemoryFileSystem constructor shape; its failed
  setup was corrected before the successful checks.
- Rendered built SDK/virtual diagnostics using the maintained screenshot route
  and inspected the image: legible output without clipping. Screenshot SHA-256:
  `eedb98a875e64146b2dde34bfcd35e044945189d79aafff0394e9de0bee00e27`.

The maintained Safe Bash typecheck still exited 2 before compilation:
`Public SafeFS must preserve shared SafeJS runtime identity`, actual `undefined`,
expected `./packages/safe-js/dist/safe-fs.js`. Investigation traced this to
`tests/plugins/qualified-current-release/peer.mjs` checkout export admission;
the current invocation-cleanup public test also asserts this rejection. Repair
requires resolving that broader retired-export contract, not changing ssconvert
or weakening its preflight. This gate remains failed, not skipped or passed.

The official archive was downloaded again only into owned `out` scratch and
matched the required SHA-256; inspected source delegates ordinary and merge URI
arguments to `go_shell_arg_to_uri`. Fresh native runtime cells were unavailable:
Docker could not connect to `/var/run/docker.sock`. The historical pinned
dependency/plugin/C-locale profile and its 35 matches remain historical evidence,
not newly measured matches for this revision. No new native-equivalence pass is
claimed. Capability-disabled HTTP remains a known safety divergence.

Final source SHA-256 identities (dirty workspace; no commit):

| Candidate file | SHA-256 |
| --- | --- |
| `packages/ssconvert/src/io/index.ts` | `b9319f7187037718489c157045bea9e943f351b37ef1e06882fadce11d98fa2b` |
| `packages/ssconvert/src/io/binding.test.ts` | `d59bf5780ff03073228126eb1e8f328f9df9069f61c006fa3a4a01d5957a1e52` |
| `packages/ssconvert/src/io/authority-cleanup-stress.test.ts` | `43181911281a679db8605f2dd1a3e21f8c0f75e6cd5942016004a5563dffb648` |
| `packages/ssconvert/src/resource-uri.ts` | `c3a7620b358c774c08ae65bc1f89b5b31eef69d901fb088aaa21ac159518a5cf` |
| `packages/safe-bash/src/commands/ssconvert/index.ts` | `9f02e734059879359e5dac3ea2084d66108122aa9d7d2e2b4dcd16b252296c22` |
| `packages/safe-bash/tests/commands/ssconvert.test.ts` | `6f5e820a48890c7e294b91dc923b358c606b0b7e981c9665c92ec7197e7337f1` |

No full repository gate was run for this focused IO follow-up. Original Node
ESM execution was checked; checkpoint/replay, browser/workerd runtime cells,
alternate dependency/locale profiles, real remote adapters and bounded performance
remain unverified. Prior limitations above still apply, including host-owned
never-consumed/redirect transport resources without a disposal hook. No README
edits, commits, remote-main delivery, push, publication or release occurred.
