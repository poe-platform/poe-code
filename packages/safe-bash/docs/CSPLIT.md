# Bounded csplit

`csplit` is included in `agentCommands()`. It splits virtual files or stdin at
line numbers and GNU basic regular expression boundaries. It never invokes a
host utility, opens implicit host files, or enables network access.

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "poe-code/safe-bash";

const fs = createMemoryFileSystem();
await fs.mkdir("/work");
await fs.writeFile("/work/input", new TextEncoder().encode("alpha\nbeta\ngamma\n"));
const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands({
  csplit: { limits: { maxFiles: 16 } },
}));
try {
  const result = await shell.exec("csplit -f part -b '%03d.txt' input '/beta/'");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

This produces `part000.txt` containing `alpha\n`, `part001.txt` containing
`beta\ngamma\n`, and stdout `6\n11\n`. The same command can be stored in a VFS
script and executed with `sh script.sh`.

## Command interface

`csplit [OPTION]... FILE PATTERN...` accepts `-` for stdin. Positive line numbers
split immediately before that line. `/BRE/[OFFSET]` retains the preceding
section; `%BRE%[OFFSET]` discards it. Signed or unsigned offsets move the split
boundary relative to the matching line. `{N}` repeats the preceding pattern
another N times, while `{*}` repeats until the applicable end condition.

- `-f PREFIX` / `--prefix=PREFIX`: output prefix, default `xx`.
- `-b FORMAT` / `--suffix-format=FORMAT`: one integer printf conversion, with
  literal text and `%%`; integer conversions are `d`, `i`, `u`, `o`, `x`, `X`.
- `-n DIGITS` / `--digits=DIGITS`: minimum numeric suffix width, default 2.
- `-k` / `--keep-files`: retain output files after errors.
- `-z` / `--elide-empty-files`: omit empty outputs and their counts, reusing the
  suffix index for the next retained output.
- `-s`, `-q` / `--quiet`, `--silent`: omit byte counts.
- `--suppress-matched`: omit matching lines from retained output.
- `--help`, `--version`, and `--`: information and option termination.

Without `-k`, failures remove output entries owned by this invocation, including
pre-existing entries it truncated. This is cleanup, not rollback: previous
contents are not restored, and already written counts remain on stdout. With
`-k`, partial output remains. GNU's numeric/repetition and empty-input error
cases do not all have the same cleanup behavior.
Cleanup failures propagate. If creation succeeds but the provider cannot return
the created entry's identity, cleanup refuses an unsafe deletion and may leave
that artifact behind.

## SDK configuration

`createCsplitCommand(options)`, `createCsplitCommands(options)`, and
`csplitCommands(options)` are exported from the package and the
`poe-code/safe-bash/commands/csplit` subpath. Their shared
`CsplitCommandsOptions` accepts `limits`, `replace`, `regex`, and `regexExecutor`.
The standalone plugin manages its executor lifecycle; an injected provider
remains caller-owned. Factory-created definitions retain invocation cleanup.

In the aggregate preset, use `csplit.limits`; replacement, regex configuration,
and provider injection belong to top-level `AgentCommandsOptions`. Csplit uses
the existing shared executor rather than a second independent aggregate pool.
Numeric-only operations do not require a regex worker.

Every supplied limit must be a positive safe integer. Defaults are:

| Limit | Default |
| --- | ---: |
| `maxArguments` | 4096 |
| `maxArgumentBytes` | 65536 |
| `maxPatterns` | 1024 |
| `maxInputBytes` | 33554432 |
| `maxBufferedBytes` | 67108864 |
| `maxLines` | 262144 |
| `maxLineBytes` | 1048576 |
| `maxFiles` | 4096 |
| `maxFileAttempts` | 8192 |
| `maxOutputBytes` | 33554432 |
| `maxDiagnosticBytes` | 65536 |
| `maxPathBytes` | 4096 |
| `maxPathDepth` | 128 |
| `maxWork` | 67108864 |
| `maxEmptyChunks` | 4096 |
| `maxRegexPatternBytes` | 8192 |
| `maxRegexNodes` | 4096 |
| `maxRegexDepth` | 64 |
| `maxRegexStates` | 16384 |
| `maxRegexAllocatedUnits` | 1000000 |

Regex limits also respect the shared engine ceilings; path depth cannot exceed
4090. Pattern preparation, repeated compilation/search and byte processing
charge one invocation work allowance. File attempts are bounded separately from
retained files so empty-output elision cannot create unbounded work. Count and
diagnostic output share a byte allowance. These are deterministic operation and
allocation limits, not a promise about host process RSS or hostile provider code.
The default portable regex provider has an additional 65536-byte subject limit,
so a larger `maxLineBytes` alone does not permit regex matching on longer lines.
Provider-level limits and the command's limits both apply.

`maxBufferedBytes` includes twice the admitted input payload, 128 accounting
units for each retained line or partial-line reference, 256 units plus twice the
path's character count for each retained output receipt, and the active output
buffer (at most 65536 bytes). Finishing an output releases its buffer; cleanup
releases its receipt reservation. Only the immediate parent snapshot remains
retained after output creation. Admission checks run before payload allocation.
These limits apply together, so reaching one configured maximum does not promise
that every other maximum can be reached simultaneously; fragmented input and
retained outputs also consume the allowance.
Non-streaming reads additionally reserve the complete returned file array before
requesting it, pass its admitted size as the read bound, and retain that separate
charge until cleanup. Streaming avoids this extra retained-array allowance.

Output uses a bounded 65536-byte buffer. A full buffer and a completed output
flush before byte counts are printed. Ordinary input or pattern errors flush
pending bytes before the `-k` retention decision. Cancellation discards pending
bytes; `-k` retains only the already committed prefix. This follows GNU's stdio
error-versus-signal policy, but does not promise GNU's platform-dependent buffer
threshold (the GNU 9.11 macOS comparison used 8192 bytes). A refused atomic flush
commits no prefix and prints no byte count for that output.

## Environment and compatibility boundaries

`LC_ALL`, `LC_CTYPE`, `LC_COLLATE`, and `LANG` select the supported C/POSIX or
C.UTF-8/C.utf8 profiles. Other regex locales are rejected rather than silently
using a different matching dialect. `POSIXLY_CORRECT` stops option permutation
after the first operand. No command-specific environment configuration exists.

File content remains raw bytes, including NUL, CR and high bytes; matching
excludes only the terminating LF from each line. Filesystem paths must be valid
UTF-8, and command arguments cannot contain NUL. Input/output alias checks and
bounded resource refusals intentionally protect the virtual input rather than
copying unsafe or unbounded native effects. Filesystem identity and cleanup
guarantees remain limited by the injected provider's declared capabilities.
Output requires the `atomicFileMutation` capability and both
`writeFileConditional` and `removeFileConditional`. Directories require stable,
scoped device/inode identity; output entries additionally require a revision.
Opening, appending, and removing an output atomically compare the captured
parent and file snapshots. Completed writes return their original committed
snapshot even if cancellation arrives before the response. Cleanup cannot adopt
or remove a replacement entry. Providers without these methods refuse output
mutation; checking a path before an ordinary write is not a fallback.

Output directories and entries require stable, scoped device/inode identity;
symlink output parents and existing symlink outputs are refused. Existing outputs
are also refused when known input metadata cannot establish its identity. A
provider without these capabilities is not silently treated as a safe writable
backend, and cancellation does not undo already completed external effects.

The native comparison reference is GNU coreutils 8.30 from Ubuntu
8.30-3ubuntu2. Help and version output identify the virtual command, rather than
impersonating the native executable. Passing finite differential cases is not universal GNU parity,
locale completeness, POSIX certification, or qualification of every filesystem
backend. See `docs/plans/issue-679-csplit.md` at the repository root for the
implementation and validation record.
