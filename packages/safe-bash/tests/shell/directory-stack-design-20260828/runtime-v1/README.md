# Directory-stack author candidate

Status: author implementation/validation; not independently accepted.

ROOT authorized exactly `src/shell/runtime.ts` and `src/shell/shell.ts` after
LET acceptance. Baseline composition is `5137a74ec855a32d8a8860eb66b62eb44d11e290`,
the two accepted WebDAV blobs from `ca1d33424b94a21ae0f40a36412fd8191611e2df`, and
runtime from `c26892c3a1a419311c9cf46a6c2976e696e00624` (includes accepted cd464).
The baseline full846-member package was
`21c4858e6e4b857cd5e0d526159667621bcd206b4f1fd1ce1f84b54ad7abbace`.
Do not substitute a moving HEAD or another owner's pending integration.

Authority: `../final-v1/PACKET.md` at053505fc plus complete root ratification at
232c2f35. Different precode freeze30235127 plus8a930834 remains unchanged. This
author suite does not execute or reclassify the different reviewer's138 rows.
The new builtins do not increment the aggregate plugin command inventory.

## Public usage on the candidate package

This complete example uses only existing public APIs. It requires a built package
containing this candidate, not the older accepted package that lacks the builtins.

```typescript
import { Shell, MemoryFileSystem } from "virtual-bash";

const fs = new MemoryFileSystem();
await fs.mkdir("/work");
await fs.mkdir("/project");
const shell = new Shell({ fs, cwd: "/work" });
try {
  const result = await shell.exec("pushd /project; dirs -l -p; popd");
  if (result.exitCode !== 0) throw new Error(result.stderr);
} finally {
  await shell.dispose();
}
```

Expected stdout is `/project /work\n/project\n/work\n/work\n`.

Each exec starts fresh from configured cwd/env. Functions, source/eval and braces
share the execution's stack. Subshells, pipelines, substitutions and invoke copy
it; interpreted new processes start empty. A tail is not a persistent Shell
session API or a filesystem directory list. No content reads or mutations are
performed by the three builtins; real cd routes through accepted stat/X_OK.

The stack-specific cwd stamp preserves actual publication through enclosing
same-State middleware frames, even for the same borrowed path or later ordinary
cd back to it. Ordinary-cd-only behavior is unchanged. This is an intentional
new stack-specific enclosing-frame behavior, not a general middleware repair.

## Bounded selected profile

- Separate dirs flags `-c`, `-l`, `-p`, `-v`; pushd/popd `-n`, signed selectors
  and command-specific `--` handling follow the complete packet, not generic
  getopt parsing. -n stores raw strings and performs no directory lookup.
- Default display uses virtual raw HOME component-prefix abbreviation; -l
  bypasses HOME; -v uses original full-stack indexes. Names are output as data,
  not shell-escaped strings. Raw whitespace and newlines are preserved.
- 4096 remembered entries, 4194304 remembered UTF8 bytes, 65536-byte admitted
  paths/reached fields/used HOME. Limits are private, not new ShellLimits fields.
- 8388608 stack work units, separate from the accepted CdLookup8388608 bound;
  neither is a global deadline/RSS/RPC guarantee. Every128 admitted steps yields
  interruptibly; partial scheduling batches flush before publication/delegation
  and return. Existing shell budgets are not reset or charged as extra commands.
- One8388608-byte display allowance covers required cd printing plus stack
  printing; chunks are at most16384 bytes and each write is awaited. Work may
  reach its separate bound first. Not every ceiling is independently reachable.
- Owned diagnostic payload is capped at65792 UTF8 bytes, excluding existing
  shell origin prefix/final newline, with exact ` [truncated]` suffix when needed.
- Swap/rotation pre-cd tail effects survive lookup/readonly failures. Ordinary
  push/top-pop publish tail only after cd INCLUDING required print succeeds.
  Published cwd/tail and emitted prefixes are not rolled back on later failure.
- Strong readonly protections, empty-cd-to-dot divergence, bounded help refusal
  and safe signed64 extreme handling remain explicit project qualifications.
  DIRSTACK arrays/special binding, stack-tilde, physical-cd improvements and full
  Bash help/native parity remain outside this candidate.

## Reproducible author checks

```
node tests/shell/directory-stack-design-20260828/runtime-v1/validate.mjs NN SOURCE_COMMIT full
```

Use an unused two-digit capture number. WORKTREE admits only the two owned source
blobs, never the rest of live source; a source commit is required for final review.
Inputs are selected via Git blob reads (no whole-history archive/AGENTS copies).
The full baseline README and package metadata accompany the build and package.
Build tools use the explicit existing development node_modules link; the offline
installed/moved package has no source/dependency fallback. Recorded source and
package membership/hashes/modes are checked, including added directories/files.
The loader authenticates actual emitted module loads, and tamper controls must
reject altered runtime bytes. Product mutation controls use separately recorded
mutated inventories and must fail behavior assertions, not parsing/imports.

Raw captures are append-only compressed JSON with inputs, both source blobs,
author harness bytes, commands/stdout/stderr/statuses, package and cleanup result.
Keep failed captures and distinguish focused checks, existing regressions, type
checks, loader negatives and behavior mutants. No full-gate claim follows.

The original stack34 native/34 virtual0-match history, four topology observations
and eight additional native-only grammar observations are untouched. No new GNU
5.3 execution or original stack rescore is performed. Existing variable-scope
regressions may execute their unchanged `/bin/bash` oracle; that is not a new
GNU5.3 stack oracle. CD87 includes28 frozen-observation mappings, not a new native
run or erasure of C28's documented empty-path divergence.

Selected LET56 literal regressions exclude the known original P39 fixture with
missing function argv and P58 unsupported-set-u fixture; their original evidence
and accepted versioned review remain unchanged. This is explicitly a selected
regression replay, not a new81/81 or103/103 result. LET's runtime method itself is
also required to remain byte-identical to the accepted base.

Author attempt01 is preserved:57/82 plus two TS diagnostics, caused by missing
virtual `/dev` fixture directory, wrong ShellOptions key and assignment to a
readonly context property. No production fix was needed for those failures.
Attempt02 corrects the fixture setup (ordinary virtual `/dev/null` file, NOT a
claimed device), typed `commands` option, explicit middleware overlay, and removes
redirection mutations from the readonly/no-metadata control.82/82/types/build.
Attempt03 adds full layout/regression/control evidence on the same product bytes;
later captures append coverage and exact committed-source validation separately.

Read `HANDOFF.md` for the final candidate/evidence hashes and measured results.
Runtime is frozen after that checkpoint for Locke's different review; no dotglob,
alias, parser, provider, contracts, root exports, metadata or default-count edits.
