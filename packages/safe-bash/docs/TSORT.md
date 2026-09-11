# tsort

`tsort [FILE]` reads pairs of byte-valued node names and writes one node per
line in a deterministic topological order. Omitted `FILE` and `-` read stdin;
`--` ends option parsing. A lone `--help` or `--version` (including an
unambiguous long-option prefix) prints virtual-bash information, not a GNU
version/license banner. Other options are rejected. At most one operand is
accepted. Without `POSIXLY_CORRECT`, options are recognized after operands;
when that variable is present, the first operand ends option parsing.

## API

`createTsortCommand(options?)` returns one command definition;
`createTsortCommands(options?)` returns its one-element command collection;
`tsortCommands(options?)` returns the registration plugin. `TsortCommandsOptions`
contains optional `replace` (default `false`) and `limits: Partial<TsortLimits>`.
Limits are copied and validated at factory construction. Each supplied value
must be a positive safe integer. The command uses no clock, regex executor,
host process, host filesystem, or network fallback.

| Limit | Default | Accounting |
| --- | ---: | --- |
| `maxArguments` | 4,096 | Argument count |
| `maxArgumentBytes` | 65,536 | Total raw argument bytes |
| `maxInputBytes` | 33,554,432 | Actual input fragment bytes, cumulative |
| `maxTokenBytes` | 1,048,576 | Entire physical token, including bytes after NUL |
| `maxTokens` | 2,097,152 | Physical tokens, including repeated/self pairs |
| `maxNodes` | 131,072 | Distinct C-string node identities |
| `maxEdges` | 1,048,576 | Non-self relations, including duplicates |
| `maxBufferedBytes` | 33,554,432 | Charged retained storage and allocation overlap |
| `maxOutputBytes` | 67,108,864 | Cumulative stdout bytes |
| `maxDiagnosticBytes` | 65,536 | Cumulative stderr bytes |
| `maxWork` | 134,217,728 | Cumulative parsing, copying, lookup, sorting, scanning and output work |
| `maxEmptyChunks` | 4,096 | Cumulative empty producer fragments |

The retained-storage ledger includes argument materialization, owned input
fragments, token-buffer growth overlap, retained names, graph node/edge charges,
ordering arrays, and transient stdout encoding. Nodes carry a 160-byte logical
charge plus four bytes per name byte; edges carry a 48-byte charge. These are
explicit command accounting units, not measurements or guarantees of JavaScript
engine heap/RSS. Diagnostics have a separate bounded allowance so an exhausted
main work/storage budget can still report an error. The readFile-only fallback
reserves its bounded snapshot before reading and counts that snapshot alongside
the owned fragment copy. Streaming providers avoid whole-file snapshots.

## Ordering and bytes

- Initial zero-indegree nodes are ordered by unsigned byte lexicographic order.
  Newly available nodes join the FIFO tail, rather than a priority queue.
- Successors are visited in reverse relation-input order. Duplicate edges remain
  significant. Self-pairs create nodes without creating edges or cycles.
- Only SPACE, TAB and LF separate tokens. CR, VT and FF are node bytes.
- Embedded NUL terminates a node's identity and displayed name, matching the
  reference C-string behavior. Bytes after NUL remain part of that physical
  token for parity and limits; a token beginning with NUL names the empty node.
- Payload names need not be UTF-8. File operands must be valid UTF-8 because VFS
  paths are strings. Invalid UTF-8, malformed JavaScript surrogate strings, and
  NUL arguments are rejected without replacement-character repair. A UTF-8 BOM
  remains part of a filename.

The graph is built before sorted output. An odd token count fails with no
sorted stdout. Cycles report a loop header and the selected cycle's raw node
names on stderr, remove one relation in the reference's deterministic order,
and continue sorting. Completed cyclic runs return status 1; their stdout is
intentional, not rolled back. Limits, cancellation or output failures can stop
an already-started ordering or cycle report; earlier writes remain visible.

## Environment and failure policy

Node ordering and delimiters are byte based and do not consult locale variables.
Diagnostics use English/C-profile quoting; `LANG`, `LC_ALL`, `LC_CTYPE`,
`LC_COLLATE`, `LC_MESSAGES`, `LANGUAGE` and `QUOTING_STYLE` do not select localized
messages or quoting. `POSIXLY_CORRECT` is the only command-specific environment
input. No native-locale parity is claimed outside the captured C profile.

A provider-reported directory operand returns status 0 with empty output,
matching the installed GNU 8.30 readable-directory case. Other VFS read errors
are explicit failures: the command does **not** reproduce GNU 8.30's unchecked
stdio `ferror` suppression. Provider character devices, including the virtual
null device and VFS symlinks to it, use the same bounded reader as regular files;
no host device is opened implicitly. Other non-file operand types are refused.
Provider metadata, access and streaming capabilities remain authoritative; this is not
an emulation of host descriptor permissions or every device behavior.

Input fragments are copied before advancing/finalizing their producer. Output
writes honor backpressure. Cleanup is registered before source acquisition and
is idempotent; admitted cooperative reads/writes drain before iterator cleanup
and public completion. Caller cancellation, including falsey reasons, takes
precedence over late failures. Primary and cleanup failures are both retained
when cancellation does not take precedence. Unenrolled opaque host sinks retain
the shell's interruptible semantics; uncooperative provider work cannot be
forcibly stopped. The command itself creates, truncates or removes no VFS files.

## Finite reference evidence

The reference is installed Ubuntu `coreutils 8.30-3ubuntu2`, `/usr/bin/tsort`,
and the full 573-line GNU utility plus cached helpers. The patches-applied
Ubuntu source commit is `26a1fa64acd11d62b28a59fab6b938ab57d12ba7`;
`tsort.c` SHA256 is
`158ea317d09c586d3d02bcd676f5c8676a76c55276dbd00f016dbb45eaf45b8f`.
All 14 cached source/helper/header files match the upstream 8.30 slice.
Installed binary MD5 `f92d5afe16b7ecc0d1f6afd04f2614c0` matches the local package
manifest. This does not establish package signature verification, a verified
Git object, generated-header equivalence or a reproducible binary build.

Author fixtures preserve 41 initial native captures plus three additional
captures. Of those 44, 41 compare exact stdout/stderr/status; the three native
help/version captures are retained but tested separately against the explicitly
different virtual information banners. Native capture SHA256:
`438da951d6ad2f227d8213b8b3835688127646340729862473797f8f6501bd6e`
for the initial `native.json`. Independent graph, diagnostic and lifecycle tests
provide additional finite evidence, not an all-input or all-GNU-version claim.
