# Virtual tar — author checkpoint

This subtree supplies an explicit, zero-runtime-dependency `tar` plugin. It
creates, lists, and extracts actual interoperable archives. It is **not full
GNU tar parity, independent verification, or a project-completion claim**.
Root exports, package subpaths, and `agentCommands()` integration belong to
Curie; this author change does not edit or enable them.

## Integration API

`index.ts` exports:

- `archiveCommands(options?: ArchiveCommandsOptions): VirtualShellPlugin`
- `createArchiveCommands(options?: ArchiveCommandsOptions): readonly CommandDefinition[]`
- `createTarCommand(options?: ArchiveCommandsOptions): CommandDefinition`
- `ArchiveCommandsOptions`, `ArchiveLimits`, and `DEFAULT_ARCHIVE_LIMITS`

Options are `{ replace?: boolean, limits?: Partial<ArchiveLimits> }`.
Construction validates and snapshots limits. Registration preflights the
single `tar` collision before changing the registry; replacement is opt-in.
The command owns no process-global state and needs no plugin disposal hook.

Curie's root integration import is `./commands/archive/index.js`. The current
repository-local TypeScript usage is:

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "./src/index.js";
import { archiveCommands } from "./src/commands/archive/index.js";

const fs = createMemoryFileSystem();
await fs.mkdir("/input");
await fs.mkdir("/output");
await fs.writeFile("/input/data", Uint8Array.of(0, 255, 128, 10));
const shell = new Shell({ fs }).use(agentCommands()).use(archiveCommands());
try {
  const result = await shell.exec("tar czf - -C /input . | tar xzf - -C /output");
  if (result.exitCode !== 0) throw new Error(result.stderr);
} finally {
  await shell.dispose();
}
```

Other tested virtual shell flows include:

```sh
tar -cf bundle.tar -C /input .
cat bundle.tar | tar -tf -
tar -cf - -C /input . | gzip | tar -xzf - -C /output
tar -czf - -C /input . | gunzip | tar -xf - -C /output
tar -xf bundle.tar -C /output --strip-components=1 --exclude='*.tmp' ./tree
printf 'data\0' | tar -cf - -C /input --null -T -
```

`ShellResult.stdoutBytes` or an injected `ByteSink` carries archive bytes; do
not round-trip them through `stdout` text. The command does not install `gzip`,
`gunzip`, `cat`, or other tools; those examples use the existing agent bundle.
The same byte-first rule matters for a listing whose first filename begins
with U+FEFF: tar preserves the UTF-8 BOM bytes, but the shared Shell's `stdout`
convenience decoder removes an initial BOM. The author test asserts
`stdoutBytes`; that shared text-decoder behavior is outside archive ownership.

## CLI profile

Exactly one of `-c`/`--create`, `-t`/`--list`, or `-x`/`--extract`/`--get` is
required. Supported common options:

| Option | Behavior |
| --- | --- |
| `-f`, `--file` | Named VFS archive, or `-` for binary stdin/stdout. Omission also means `-`; no host tape/environment default. |
| `-z`, `--gzip` | Streaming gzip creation or decoding. Input compression is not guessed; use `-z` explicitly. |
| `-v`, `--verbose` | Names for creation/extraction; metadata listing for `-t`. Repeated `-v` is the same boolean setting. |
| `-C`, `--directory` | Position-sensitive, VFS-resolved directory changes. Relative changes are relative to the previous directory. Archive and file-list filenames remain relative to the invocation cwd. |
| `--strip-components=N` | Extract after removing N original nonempty slash components, including leading `.` components. A name entirely removed is skipped. Listing keeps original names, as in the frozen GNU observation. |
| `--exclude=PATTERN` | Component-start, unanchored glob exclusions; `*`, `?`, bracket ranges/negation, and backslash escaping outside brackets. Wildcards can match `/`. Excluding a directory excludes descendants. |
| `-T`, `--files-from` | Names from a VFS file or `-` stdin; repeated file lists supported. |
| `--null`, `--no-null` | Select NUL/newline file-list separation. NUL mode always treats names literally. |
| `--verbatim-files-from`, `--no-verbatim-files-from` | Control file-list option handling; verbatim preserves literal dash/backslash names. |
| `--format=pax`, `--format=posix`, `--format=ustar` | Creation format. Default PAX extends USTAR when needed. Strict USTAR rejects metadata that requires extensions and truncates fractional mtime to whole seconds. |

Modern short clusters, attached short-option values, traditional initial
`tar czvf archive files`, long `--option=value`, and `--` are supported. In
traditional clusters values follow the entire cluster in argument order; in
modern clusters an argument-taking option consumes the rest of the cluster.

Selection operands are literal archive names or directory prefixes, not
wildcards. They match original names before stripping. Missing requested
members fail. All duplicate occurrences are processed in archive order.
Positional `-C` before a selection chooses that selection's extraction root.
Create exclusions must precede source operands; late exclusions fail rather
than silently applying a misleading global/position-sensitive interpretation.

Default newline file lists accept `-Cdir`, `-C` followed by a directory on the
next line, and `--directory=dir`. Their changes affect subsequent operands.
Other option lines, recursive `-T` directives, and backslash unquoting are
rejected; use `--null` or `--verbatim-files-from` for literal filenames.
NUL autodetection is not implemented. Unlike prose in the GNU manual, the
**pinned GNU 1.35 executable preserves surrounding filename whitespace**;
the frozen `" alpha "` observation is retained and the implementation follows
that behavior. Newlines inside names require NUL separation. Empty list
records are ignored. An explicit empty `-T` can create an empty archive;
creating without any operands or file list fails. Archive stdin and file-list
stdin cannot be shared during list/extract, and a stdin file list is single-use.

Append/update/delete/compare, `-O`, sparse/device/FIFO handling, additional
compression, dereferencing, ownership switches, transforms, wildcard selection,
ACL/xattr switches, POSIX named bracket classes, and all other options are
unsupported and produce failure. No option or archive data executes code.

## Format and metadata

- Creation emits 512-byte USTAR headers, payload padding, and two zero end
  blocks, without imposing GNU's larger tape-record padding. USTAR prefix/name
  splitting is supported; PAX records carry long/Unicode names, long linknames,
  fractional/negative timestamps, or numbers outside octal fields.
- Reading supports USTAR, PAX local `x` and global `g` headers, and GNU basic
  headers with `L`/`K` long-name records. Octal and GNU base-256 numbers are
  checked for validity, sign where applicable, and safe-integer range. Signed
  legacy checksum variants, V7 headers, GNU sparse formats and unknown types
  are rejected. Header checksums use the unsigned POSIX calculation.
- PAX lengths are **UTF-8 octet lengths including the whole record**, not
  JavaScript string lengths. Embedded newlines and `=` inside values work.
  Local values override global values, then GNU long-record and raw USTAR
  fallbacks. Empty values are deletion tombstones: they suppress lower fields,
  not resurrect them. Local state applies to the next real member (even when
  excluded); global state persists per keyword until replaced. Last duplicate
  records win, including deletion and later reintroduction.
  Missing effective path, size, or a required link target fails before that
  member's effects. Rejection of deleted size also covers zero-data types rather
  than guessing their framing. This is a conservative product policy, not a
  universal POSIX-mandated error. Checksum/envelope and extension physical sizes
  remain validated; overridden/deleted raw semantic fields are not decoded.
  Recognized keys: `path`, `linkpath`, `size`, `uid`, `gid`, `mtime`, `atime`,
  `ctime`, `uname`, `gname`, `comment`, `charset`, `hdrcharset`.
  Known optional metadata is accepted and discarded: nonempty attribute names
  under `LIBARCHIVE.xattr.` and `SCHILY.xattr.`, plus `SCHILY.fflags` and
  `LIBARCHIVE.creationtime`. This is not restoration
  of xattrs, ACLs, flags, creation time, security labels, or ownership.
  Record framing and UTF-8 keys are validated before classification; ignored
  values remain opaque bytes (including binary SCHILY xattrs), are not decoded
  as paths or retained in global/local state, and still consume header/archive
  limits. Supported values remain strict UTF-8 with no NUL.
  Unclassified extensions remain rejected, including `GNU.sparse.*`,
  `SCHILY.realsize`, `SCHILY.filetype`, `SUN.holesdata`, and volume extensions.
  ACL, security-label, symlink-type and archived inode/device/link-count keys
  outside the named xattr namespaces remain unclassified and rejected.
  No blanket vendor-prefix exemption or sparse/layout fallback is provided.
  Only UTF-8 header encoding is supported; `hdrcharset=BINARY` is rejected.
- AppleDouble `._*` regular archive members remain ordinary files. They are not
  interpreted as macOS metadata or hidden from listing. Default macOS BSD tar
  can present these differently; accepting optional PAX metadata does not claim
  identical native metadata restoration or default listing presentation.
- Member/link names are Unicode strings encoded as strict UTF-8. Arbitrary
  non-UTF-8 byte filenames and unpaired UTF-16 surrogates are unsupported.
  **Payload bytes are never decoded or translated**, including NUL and invalid
  UTF-8. Listing escapes backslashes, newlines, tabs, CR and control bytes;
  there is no NUL-delimited listing mode.
- Files, directories, symlinks, and backward regular-file hardlinks are real
  entry types, never implicit file-content conversions. Creation uses complete
  reference-scoped `identityScope`/`dev`/`ino` identity, not stringification,
  unscoped inode numbers, or adapter-instance identity. Known multiply-linked
  files with unknown identity fail. Hardlinked symlink sources are unsupported.
  Duplicate archive-path bindings invalidate stale hardlink targets during
  creation, including `file` versus `./file` aliases.
- Extraction hardlinks require a previously extracted regular file at the
  transformed target path in the same selected root. Forward, self, unselected,
  preexisting-only, or non-regular targets fail. Observed changes in complete
  backing identity fail; identity-unknown targets cannot be checked for same-type
  replacement. Unsupported backend links fail; there is no copy fallback.
  Replacing a regular file unlinks and exclusively creates it, leaving earlier
  hardlinked versions untouched.
- Created headers record numeric UID/GID when provided, ordinary/special permission
  bits, mtime, and (PAX) atime. Missing creation UID/GID become zero; no owner names are
  invented. There is no FS ownership API: extraction does **not** chown, restore
  owner/group names, ctime/birthtime, ACLs, or xattrs. Supported `chmod`/`utimes`
  restore ordinary `0777` permission bits and atime/mtime; setuid/setgid/sticky
  bits are not restored. Symlink and hardlink metadata is not independently
  reapplied. Backend capability flags/methods govern restoration. Unsupported
  metadata is not represented as preserved. Timestamp precision remains that
  of JS numeric milliseconds and the FS; PAX rendering has at most nine
  fractional-second digits. Deleted input UID/GID/mtime are displayed as `-`,
  not invented zero values. Deleted mtime is not restored: normal backend
  creation/write (or existing-directory) state remains. Absent atime retains the
  historical atime-from-mtime fallback; explicitly deleted atime suppresses it.
  If just one timestamp is requested, a fresh post-write/post-chmod stat supplies
  the other for paired `utimes`; stat/utimes errors and cancellation propagate.
  This is non-atomic best-effort preservation, not an omission primitive, lease
  or pathname-race guarantee. Neither requested time means no `utimes` call.
  Verbose listing otherwise uses numeric IDs/seconds, not
  byte-for-byte GNU date/locale formatting.
- Directory metadata is deferred until successful archive validation, children
  before parents. Tar requests `0700` for new intermediate directories without
  an explicit directory member and `0600` for newly opened files/archives.
  Actual enforcement requires backend permission support; these modes may be
  advisory or ignored on other backends.
  There is no ambient host umask, user database, filesystem, or process lookup.

## Extraction and publication safety

The selected `-C` directory must exist and is resolved by the VFS, including
explicit directory aliases. All operations below that resolved root inspect
ancestors with `lstat`. **Writes never traverse symlink ancestors**, even ones
that currently point safely inside the root. A final symlink can be replaced
without following it. Directory replacement uses only the optional safe
`rmdir` primitive; nonempty directories are not recursively deleted.

Absolute member names lose leading `/`, with a warning, and remain beneath
the selected virtual root. Every extraction member name containing a `..`
component is rejected **before exclusions or stripping**, so those options
cannot disguise traversal. Creation is different: native-compatible name
prefixes through the last `..` are stripped while the original source path
is resolved by the VFS (including symlink-before-`..` semantics). `./`, safe
relative names, Unicode and long paths remain supported.

Symlinks must have relative, contained targets. Ordinary leading `../` links
inside a nested directory are supported. Existing target symlink chains are
checked without following them outside the extraction root. Targets containing
non-leading `..` (for example `later/../file`) are rejected, including in
expanded preexisting chains: a later `later -> .` could otherwise turn a
previously safe-looking link into an escape. Safe nested link chains remain
actual symlinks. This is a deliberate safety restriction, not GNU parity.

Named archive output is fully preflighted for sources and observed aliases
before opening. An explicitly requested input that aliases the output fails;
a recursively discovered output archive is omitted with a warning. Existing
output archives must be ordinary files with complete identity, as must their
regular-file sources; unknown identity cannot justify destructive replacement.
The output identity is rechecked before unlink/exclusive-create. Consequently
new archives work on identity-unknown remote backends, but replacing existing
archives there is unsupported. Named-input extraction also refuses observed
input aliases and refuses replacement of existing regular destinations if
their distinctness from the input archive cannot be established. Stdin does
not expose an upstream filename/identity; hidden aliases through an external
producer cannot be detected by this command.

**There is no whole-archive transaction or rollback.** Accepted earlier
members remain after late checksum failure, truncation, gzip CRC failure,
unsupported entries, output errors, or cancellation. The current member and
new parents can remain partial; replacing an existing leaf can remove its old
version before the new body is complete. Named archive output can likewise be
partial on failure. Directory metadata may not yet have been restored.
Tests check these effects, rather than claiming atomic publication.

Source type/identity/size/mtime/ctime are checked around file reads; short/long
reads and observed changes fail. This is not a snapshot, file lease, ABA
defense, or race-proof filesystem sandbox. Shared FS contracts do not expose
descriptor-relative atomic containment or unlink/link transactions. Host or
remote actors changing the namespace concurrently remain an adapter/OS
isolation concern; RealFS's existing race limitations are not fixed here.

## Streaming, cancellation, and bounds

Payloads flow lazily through async iterators; commands await output writes.
Gzip/gunzip use Node's built-in zlib streams with bounded chunks and a
backpressured producer, not whole-archive compression buffers. Inflate output
is bounded independently of compressed input. End markers and all trailing
record padding are consumed, so late gzip trailer errors cannot become success.

All FS calls check cancellation first and receive the signal. FS/sink/source
waits are abort-aware and observe late rejection. Zlib tasks are destroyed and
their producer promises observed on completion/error/cancellation. Iterator
cleanup is requested without blocking forever on an uncooperative producer.
This does not forcibly terminate an uncooperative host operation, undo effects,
or interrupt synchronous code. Tests cover cooperative cleanup and observed
late rejections, not universal first-read cancellation. Existing shared
`head -n 0` no-read lifecycle limitations remain separate; this subtree adds no
shared lifecycle API. Partial consumers (`head -c 16`) and rejecting sinks are
tested for plain and gzip output.

The adapter's streaming methods are used when present. Without streaming reads,
`readFile` is allowed only under the bounded-file fallback. Without streaming
writes, publication uses exclusive empty creation and awaited chunk appends.
Adapters may themselves buffer or perform noncooperative work; tar cannot
change their memory/cancellation semantics. Source-provided chunks may already
exist as larger allocations before tar receives them.

All limits are positive safe integers; `chunkSize` must be 512–1,048,576 bytes.
Defaults, configurable under `options.limits`:

| Limit | Default | Accounting |
| --- | ---: | --- |
| `maxArchiveBytes` | 268,435,456 | Each compressed and uncompressed archive stream, including headers/padding/trailers. |
| `maxEntryBytes` | 67,108,864 | One regular-file payload. |
| `maxTotalBytes` | 268,435,456 | Sum of regular-file payload sizes, including excluded/unselected entries when reading. |
| `maxMembers` | 10,000 | Source traversal/operands and emitted/read headers; PAX/GNU extension headers count. |
| `maxPathBytes` | 4,096 | UTF-8 member/link/source operand bytes. |
| `maxDepth` | 128 | Path/traversal depth; target chains also have a 40-symlink ceiling. |
| `maxPaxBytes` | 1,048,576 | One extended-header body and each accumulated local/global keyword state. |
| `maxFilesFromBytes` | 1,048,576 | Aggregate input file-list bytes. |
| `maxArgumentBytes` | 65,536 | CLI argument bytes. |
| `maxTextBytes` | 1,048,576 | Listing, verbosity and warning output per command. |
| `maxDiagnosticBytes` | 4,096 | One additional failure diagnostic (message also limited to 1,024 characters before escaping). |
| `maxPatternSteps` | 10,000,000 | Exclusion matcher token/path state transitions. |
| `maxBufferedFileBytes` | 1,048,576 | Non-streaming read fallback. |
| `chunkSize` | 65,536 | Archive/zlib chunk size and requested FS read chunk size. |

The source manifest and identity/name maps are bounded metadata, not payload
buffers: their worst case scales with `maxMembers * maxPathBytes`. File-list
and PAX buffers have separate bounds. Shell budgets remain separate.

## Native profile, evidence, and deliberate differences

Primary research consulted the official GNU tar 1.35 manual (basic format,
selection, file lists) and The Open Group POSIX.1-2024 Issue 8 `pax` specification
(USTAR layout, PAX byte-length framing, keyword precedence, file times):

- `https://www.gnu.org/software/tar/manual/html_node/Standard.html`
- `https://www.gnu.org/software/tar/manual/html_chapter/Choosing.html`
- `https://www.gnu.org/s/tar/manual/html_section/files.html`
- `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/pax.html`

The web tool returned the GNU pages. Its POSIX renderer returned empty results;
the primary POSIX page was then fetched directly over HTTPS and the actual
format sections read. No secondary format description substituted for it.

No installed GNU tar was found in PATH, Homebrew, `/usr/local`, temporary/local
tool roots or the workspace. `prepare-oracle.mjs` instead obtains a checksum-
pinned, dependency-free Homebrew GNU tar **1.35**, rebuild 1, arm64 Tahoe bottle,
extracting only the executable into ignored test-local `.oracle/`. It does not
install anything into the library or system. The executable is:

`tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`

Executable SHA-256:
`49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`

Bottle SHA-256:
`4e3782b9393e2e53a1cccd9c1047c2fc43b81c34746b10755050d5d162b21269`

The native tests verify that executable hash and never substitute Apple tar.
This downloaded oracle is platform-specific, not a portable test prerequisite
silently available everywhere; absence/mismatch is a test failure with setup
instructions, not a passing skip. `/usr/bin/tar` is separately recorded as
`bsdtar 3.5.3 / libarchive 3.7.4`, SHA-256
`bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9`.
In the frozen file-list fixture it treats `-Cinput`/`-Csub` as filenames, while
GNU recognizes those directives. Apple/system tar is not the target oracle.

Frozen captures under `tests/commands/archive/`:

- `native-profile.json`: 14 native behavior invocations (seven GNU, seven
  Apple), plus two separate version probes; initial safe format/selection/T/C
  controls before virtual behavior corrections. `capture-native.mjs` reruns
  diagnostically without rewriting this evidence.
- `native-safety-profile.json`: eight GNU-only invocations; exact argv,
  statuses, diagnostics and namespace effects from `capture-safety.ts`.
- `native-source-profile.json`: seven GNU-only invocations establishing parent
  prefix stripping and symlink-before-parent source/`-C` resolution before the
  corresponding source change. Reproducer: `capture-source.ts`.
- `native-followup.json`: preserves the first native test assumption failure:
  the GNU forward hardlink returned 2, rather than deferring it. The initial
  native suite was 4/5, not 5/5. Its test expectation was corrected from the
  recorded native result; the product already rejected forward links.

Exact safety reproductions and outcomes (fixture constructors in
`capture-safety.ts` and author tests, all native effects restricted to temporary
directories):

| Fixture and command | GNU 1.35 | Virtual profile |
| --- | --- | --- |
| Header/body without end blocks; `tar -tf input.tar` | 0, lists file | 2, truncated archive. |
| Two end blocks then nonzero trailing bytes; `tar -tf input.tar` | 0, ignores tail | 2, rejects tail/concatenated archive. |
| Preexisting `output/link -> safe`; member `link/file`; `tar -xf input.tar -C output` | 0, traverses safe link | 2, refuses symlink ancestor. |
| Member `../escape`; `tar -xf input.tar -C output --exclude='*'` | 0, excludes it | 2, rejects parent before exclusion. |
| Hardlink member to preexisting `output/existing`, not a prior member | 0, links it | 2, requires a prior extracted target. |
| Forward `hard -> later` before `later` | 2, continues and writes later | 2, fail-fast before later. |
| `file=old`, hardlink, duplicate `file=new` | Old hardlink preserved | Same supported behavior. |
| Absolute member `/absolute` | Strips slash, writes under `output` | Same containment behavior; different diagnostic text. |

Additional deliberate restrictions include absolute symlink targets,
non-leading parent components in link targets, unknown vendor PAX keys,
unknown-identity destructive archive replacement, strict non-file zero sizes,
and fail-fast errors instead of GNU's accumulate-and-continue behavior. These
are visible limitations, not waived parity failures or superiority evidence.

## Author validation

Run from the repository root on the pinned macOS arm64 oracle environment:

```sh
node tests/commands/archive/prepare-oracle.mjs
node tests/commands/archive/run-author.mjs
npm run build
npm run typecheck
node --unhandled-rejections=strict tests/commands/archive/built-package.mjs
```

The suite uses public `Shell + agentCommands + explicit archiveCommands` for
functional flows, plus direct public command contexts for lifecycle probes.
It includes MemoryFS, RealFS and the real S3 adapter with MockS3 transport;
this is not a full remote-adapter integration matrix. Native subprocesses are
test-only fixed-argv operations with sanitized environments, bounded runtime,
and owned temporary-directory cleanup. No archive-supplied script is run.

The five native author tests make **11 GNU behavior invocations per complete
native-suite run**. Plain/gzip bidirectional interoperability comprises eight
archive reads (GNU→virtual list/extract and virtual→GNU list/extract, each in
plain and gzip); a separate GNU legacy-long-record extraction adds one read.
Do not conflate those reads, subprocess calls, virtual tests, or repeated
author runs. The runner adds a 120-second outer subprocess watchdog to the
20-second test timeout. Lifecycle tests use 1.5-second settlement watchdogs and
strict unhandled rejection handling. Final counts, source hashes, build/typecheck
results and historical author failures are recorded in the owned validation
artifact at handoff. A **different independent verifier still must follow**.
