# ZIP password capabilities

`ArchiveCommandsOptions.zipHost` is an optional, explicit trusted host binding.
The same archive options flow through `archiveCommands`, `agentCommands` and the
`runBash` SDK's `archive` option. Commands never import host randomness, access
ambient credentials, open a terminal, or spawn native tools.

`entropy(length, signal)` must return exactly the requested number of fresh,
cryptographically secure bytes. ZIP requests 11 bytes per newly encrypted member;
the twelfth header byte is the CRC high byte, or the DOS time high byte when the
descriptor flag is set. The callback must cooperate with cancellation. Callback
work belongs to the command's existing registered cleanup scope. Test entropy
is deterministic only in fixtures. There is no product entropy fallback.

`password({ prompt, maxBytes, signal })` must suppress input echo, return password
bytes, or return `undefined` on EOF. It must not consume command stdin, log
passwords, or exceed `maxBytes` (the configured `maxArgumentBytes`). Commands
copy returned bytes; NUL is refused. This is a trusted host promise, not a terminal
security enforcement mechanism. Hosts must cooperate with cancellation; cleanup
cannot forcibly settle an uncooperative host promise.

`zip -P PASSWORD` (including long `--password` and attached/clustered forms)
encrypts newly added/replaced non-directory members. Native ZIP's empty supplied
password rejection is retained. `zip -e` requests and confirms a nonempty
password; supplying `-P` satisfies password input. `unzip -P PASSWORD` uses the
supplied bytes; otherwise encrypted members request a password with at most
three no-echo attempts after verifier rejection. A verified password is reused,
with new prompts if another member rejects it. Unicode text uses UTF-8; owned
raw argv bytes and injected password bytes retain their identity. The low-level
format API can decode/encode empty password bytes independently of native ZIP's
command argument restriction.

Traditional ZipCrypto is supported; AES/strong encryption remains refused.
Every member starts fresh keys. Compression precedes encryption, and decryption
precedes decompression. The 12-byte header's verifier is not authentication.
Commands validate final CRC and expanded length before publishing encrypted
member data, including `unzip -p`; encrypted pipe output therefore uses bounded
member buffering. Copy/update/comment operations retain existing ciphertext and
its descriptor/time binding. `zip -T` uses the supplied password to validate the
serialized archive through registered virtual `unzip -tqq`. A context without
virtual invocation authority returns status 8; there is no host-process fallback.
Direct `decodeZipEntry` is a streaming primitive: consumers
must reach successful EOF before publishing its unverified chunks.

The current `poe-code bash -c` CLI is noninteractive. Its host adapter supplies
Node cryptographic entropy through the SDK, so `zip -P` works with stdout output.
Named ZIP publication still requires the filesystem's existing owned atomic
staging capability; the real-filesystem adapter currently refuses that path.
Shell stdout redirection uses its existing explicitly weaker output contract.
It has no no-echo
password provider: `zip -e` or passwordless encrypted extraction fails precisely
with `ZIP no-echo password capability is unavailable` (status 2). The SDK also
requires explicit capabilities; it does not implicitly borrow the host terminal
or RNG. Terminal prompt parity in the CLI is excluded until an explicit no-echo
host is configured. No SafeJS contract changes are required.


## Difference, grow, temporary paths and prefix removal

`-DF`/`--difference-archive` requires a named base and separate `-O` output.
It includes selected new members and size/DOS-time differences; `-u`/`-f`
still apply freshness rules. Delete/copy are incompatible. Unchanged selections
write an empty difference archive, except current filesync selections which
publish nothing. With `-m`, unchanged sources absent from the difference output
remain. Comments retain the ordinary command rules.

`-g`/`--grow` retains owned, validated local records for additions. Replacements,
deletions and explicit ZIP64 format changes rebuild; existing archives are always
published by validated atomic staged replacement, never by host or in-place
append. The existing buffered update admission remains: grow is not a promise
of bounded payload retention independent of archive size. Original bytes,
decoded compressed-member buffers and retained local records are separately
bounded by the archive limits, rather than process RSS isolation.

`-b`/`--temp-path` selects an authorized VFS directory for owned staging,
including spooling stdout before emission. Directory identity and per-path
provider capabilities must be truthful. Atomic staging is required; streamed
staging writes additionally require atomic conditional writes. Cross-provider
publication succeeds only when the supplied filesystem supports it; unsupported
moves fail and clean owned scratch, without a host-copy fallback. Stdout
spooling uses the existing buffered source/codec limits to produce known local
sizes; it does not claim output before source EOF.

`-J`/`--junk-sfx` explicitly validates an adjusted or unadjusted embedded archive,
including local/central agreement, complete contiguous spans, decoded lengths
and CRCs, before rewriting without its prefix. It never executes prefix bytes.
Unadjusted candidate scans use the archive/work limits and at most
`min(64, maxMembers)` candidates. Ordinary reads remain strict. This option does
not implement offset adjustment or damaged-archive recovery. Encrypted payload
validation requires the supplied password.

## VFS logs and virtual test commands

`-lf`/`--logfile-path` overwrites a VFS log; names with no basename extension gain
`.log`. `-la` appends and `-li` includes emitted info alongside warnings/errors.
Logs need known single-link regular-file identity and atomic conditional byte
writes. Selected inputs, output archives, aliases and selected directories
containing the log are refused. New log writes are held until source selection
proves the log is disjoint. If selection fails
before that proof, diagnostics go to the screen and existing log bytes remain.
Existing append bytes and redacted new bytes
share `maxTextBytes`. Supplied password bytes are redacted in the log. Opening
an unsafe/unavailable log returns 16; write/limit failure returns 11. Completed
log bytes and already completed archive publication cannot be undone by a later
failure; source removal still requires command success. Quiet mode suppresses screen progress while retaining eligible log messages.
Native wall-clock banners, command-line dumps and log summary formatting are
excluded; the log contains bounded redacted command messages.

`-T` uses registered virtual `unzip -tqq`. `-TT`/`--unzip-command` selects a
registered literal command plus arguments: spaces, single/double quotes and
backslash escapes are supported; shell operators, substitutions, NUL and newline
are refused. `{}` substitutes the staged path in argument values; without it,
the path is appended. Argument expansion is admitted before allocation.
Default testing forwards owned raw password bytes. Child output is bounded and
discarded; status/exception/output-limit failures map to fixed status 8 diagnostics
without leaking child errors. Current filesync and stdout retain their existing
test-skip rules. Standalone unchanged testing checks the current archive without
rewriting it. Cooperative invocation and cleanup drain before settlement.

Registered host JavaScript is trusted, and test commands should read the staged
archive. A command that mutates its staged identity cannot publish using the old
identity. Cleanup also refuses that stale identity and preserves externally
changed bytes, reporting failure; this is not a sandbox or permission to delete
those external changes.
## FIFO sources and DOS names

`-FI` / `--fifo` opts into a VFS-reported FIFO (POSIX mode type `0010000`).
The current filesystem type domain can carry this special entry as `character`;
mode identifies the FIFO independently of that carrier. The path must explicitly
report `streamingRead: true` and implement `readStream`. Unknown/false capability
or a missing reader fails truthfully; `readFile` is never a FIFO fallback.
The ordinary real adapter still rejects special nodes. ZIP never discovers or
opens a host FIFO implicitly. `-FI-` disables reads even for a file-typed FIFO
mode, and unrelated character devices remain ignored.

Eligible producer bytes are collected with owned chunk copies under remaining
entry/total payload limits and the existing filesystem work budget. Empty streams
are valid; endless empty chunks exhaust work limits. Signals, reader retirement,
registered cleanup and staged publication use the existing ZIP scope. Producer
failure, cancellation, limits or changed source metadata prevent publication.
FIFO members materialize as regular archive files. FIFO move is unsupported;
filesync/difference always consume eligible streams because zero stat size is
not payload currency. Update/freshen still apply source timestamps. Listing does
not consume producers. This is bounded buffering, not constant-memory streaming,
and cannot preempt uncooperative trusted provider callbacks.

`-k` / `--DOS-names` converts selected new filesystem names after source-name
include/exclude and `-r`/`-R` selection, then after `-j` flattening. Each component
loses leading dots and the native discarded punctuation, uppercases ASCII,
retains at most eight stem and three extension characters, and stops after the
second dot. Reserved device names are retained, without DOS device execution
semantics. Empty components, control characters, backslashes and non-ASCII names
are refused. Collisions fail before publication or move removal; no suffixes
are invented. Source paths and recursion prefixes retain their original spelling.

Native parse order is observable: include/exclude patterns read after `-k` are
themselves DOS-converted (including stripping wildcards), then matched against
case-sensitive original source names. Earlier filters retain their spelling.
`-R` patterns receive DOS conversion under the final `-k` setting. The existing
filter-before-flattening path policy remains; `-j` does not rewrite filter paths.
Archive fallback preserves existing member spelling/Unicode encoding and does
not DOS-convert it. Untouched members retain metadata and payload. New converted
members use DOS creator/attributes and ASCII names; retained Unicode comments
keep their existing encoding flag. `-k` ignores `-y`, reading its target instead.
Invalid raw UTF-8 paths remain refused by existing argument validation.

`-RE` / `--regex` is the native bracket-list glob compatibility option, enabled
by default in the pinned Unix build. It selects through the existing bounded
glob matcher with case-sensitive literals, bracket ranges, no-wild and directory
controls. It does not introduce general regex syntax, dependencies or unbounded
matching. Negation and attached values are invalid. Other build profiles require
separate qualification; a build omitting the option is not applicable to that cell.
