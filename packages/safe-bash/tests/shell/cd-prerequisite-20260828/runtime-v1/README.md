# Bounded cd prerequisite: author candidate

This implements the ROOT-ratified profile in `../ROOT-RATIFICATION-v3.md`,
`../AUTHOR-POLICY-v2.md`, and `../AUTHOR-POLICY-v3-DETAILS.md`. Production scope
is only `src/shell/runtime.ts`. The independent precode controls belong to Locke
at `beeda1a96bb25c846cd6df0cf0f7a0fff06bcf6e`, with additive policy binding
`2fbd1e051993cadf384cf4fc559f20e3f0b7cc1c`; this author does not edit or execute
those controls and does not claim different-review acceptance.

## Public behavior and limits

`cd` remains a builtin: no plugin inventory or public API change. Eligible
relative operands search virtual CDPATH in order, preserving empty components,
duplicates, and a fresh cwd fallback. Absolute and dot/dot-dot-prefixed operands
bypass CDPATH. Relative HOME/OLDPWD participate; missing variables precede limit
checks. A nonempty selected CDPATH component or dash prints the logical path
once. Explicit `cd ''` retains the existing dot behavior, unlike native C28.

Each candidate performs stat-directory then delegated X_OK before checked OLD,
cwd, checked PWD, exports and awaited printing. Existing readonly fail-fast,
prefix restoration, output-error mapping, cancellation precedence, and completed
effects survive. Only typed ENOENT/ENOTDIR/EACCES continue search; EPERM/ELOOP and
unsupported/unknown errors terminate this cd attempt. This is not full Bash
errno parity, physical cd, a new `-L`/`-P` parser, or a directory-stack feature.

Limits are the ratified inclusive 65,536-byte raw/normalized path and eligible
CDPATH bounds, 4,096 components, 4,097 probes, 8,194 public VFS calls, and
8,388,608 private work units with yields every 128 admitted units. These are not
provider-RPC, aggregate-network-deadline, RSS, or global-work bounds. No new
shared Budget charges/reset or public limit keys are introduced. The cd-owned
diagnostic payload is at most 65,792 UTF-8 bytes including any cd-owned prefix,
excluding shell-origin prefix/newline; truncation reserves exact ` [truncated]`.
Actual emitted bytes still count against the existing parent output budget.

WebDAV directory X_OK means logical navigation, not remote ACL/listing/child or
future-access permission. Public adapter checks use Memory, task-owned Real,
readonly Memory, injected MockS3Client, and injected WebDAV HTTP responses; no
new real S3/WebDAV service claim follows from these checks.

## Fixed reconstruction and commands

`validate.mjs` selects source/package/build files and explicit regression fixtures
from `5137a74ec855a32d8a8860eb66b62eb44d11e290`; it never archives moving HEAD or
copies AGENTS. Exactly two provider blobs come from
`ca1d33424b94a21ae0f40a36412fd8191611e2df`: WebDAV source and scoped README.
The new candidate supplies only its `src/shell/runtime.ts` blob. Existing Stage2
author tests come from `43af14a520160fad4e144a6b60c30ca123bd9ab9` without edits.

The runner authenticates baseline runtime equality with accepted fd1 and verifies
all 58 other Runtime members plus non-cd builtin statements remain unchanged.
Every selected input is recorded by commit, Git blob and SHA-256. Author fixture
bytes are embedded in captures, making early attempts recoverable. Builds/types
use existing dev tooling in isolated temporary roots; no installs or runtime
dependencies are added. Product imports in installed/moved layouts use bare
`virtual-bash`, with actual emitted-module hashes checked by the loader and
complete package inventories checked before/after. Tampered runtime bytes must
be rejected. The moved layout is a rename, not a source fallback.

```
node tests/shell/cd-prerequisite-20260828/runtime-v1/validate.mjs baseline UNUSED_TWO_DIGIT_VERSION
node tests/shell/cd-prerequisite-20260828/runtime-v1/validate.mjs candidate UNUSED_TWO_DIGIT_VERSION FULL_SOURCE_COMMIT
```

Output filenames are exclusive and existing captures are never overwritten.
`WORKTREE` is an explicitly recorded development mode, not a frozen acceptance
binding. The final handoff identifies the committed-blob replay separately.
All created source/consumer/data roots are removed in finally; synchronous child
commands have deadlines and record exit/signal/errors. Existing regression helpers
may create their own bounded children/loopback servers and retain their cleanup.

## Preserved native mapping and fixture repairs

`native-mapping.test.ts` consumes original compressed native28 observations;
it does not rerun or rescore them. The virtual checks compare C01-C27 after
declared root/shell-origin normalization. C16/C19 inject typed EACCES at the
virtual provider boundary rather than claiming host permissions were measured.
C28 asserts both original native failure and deliberately retained virtual
success. Thus 28 passing mapping checks never mean 28 native-parity wins.

The selected existing variable-scope regression still invokes its original
`/bin/bash` oracle ten times; its host binary hash is recorded separately. This
is not the pinned GNU5.3 native28 cohort, and no portable Bash-version equivalence
is inferred.

Initial author failures are retained in versioned raw captures, not removed:

- Version01 omitted the standardCommands printf fixture, supplied strings to the
  byte-only writeFile API, used the nonexistent S3 `client` constructor option,
  and omitted three existing regression helper files. These are author harness
  errors, including the captured strict type failures, not product fixes.
- Version02 repairs those bindings without changing production. Its remaining
  WebDAV expectation guessed a trailing-slash retry. The unchanged provider's
  stat method actually probes the parent after ENOENT to distinguish ENOTDIR.
- Version03 changes that exact expected second request from
  `/dav/absent/target/` to `/dav/absent`, preserving method/depth and every other
  request. It adds source-structure preservation checks, the existing 42-case
  owned-output cohort, and emitted-byte tamper controls. Original versions stay
  recoverable. The fresh version03 baseline is reported separately.

No production revision was needed between these development fixture versions.
The final report keeps all original failures, native/profile qualifications,
source and installed/moved denominators, and different-review status separate.
