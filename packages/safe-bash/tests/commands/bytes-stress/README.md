# Independent byte-command verification

This is the independent follow-up to the original byte-family author, not a
renamed author suite. Product ownership transferred before this work. All work
runs from `/Users/kjopek/Workspace/safe-bash`; old search/text-program source
is outside this assignment and was not edited.

## Verified fixes

- `21b43cd`: compression lexically collapsed `symlink/../file` before VFS
  resolution. Native gzip selected the real target, while the virtual command
  selected, compressed, and could remove or overwrite an unrelated lexical
  sibling. Five new regressions initially failed. Input spelling now reaches
  the VFS intact, and destinations derive from the resolved regular source.
  Original-path identity checks remain.
- `06e0d27`: an empty-only producer could keep compression in microtasks until
  input exhaustion, starving scheduled cancellation. A finite stress producer
  reproduced this without hanging the process. The reader now yields after 64
  empty chunks, including force-mode prefix probing. All three compression
  commands and `gzip -dfc` have regressions.

Both fixes are atomic owned-path commits. API remains
`byteCommands({ replace? })` / `createByteCommands()`, with eleven commands and
no new runtime dependency or host operation in product code.

## Coverage

| File | Independent checks |
| --- | --- |
| `encoding.test.ts` | Literal RFC 4648 vectors across splits/wraps; Python base64/base32 binary oracles; malformed padding, unused bits and garbage; BSD base64 dialect; native xxd width/group/address matrix; od signed/endian DataView properties. |
| `checksums.test.ts` | Fixed digest vectors; independently assembled escaped/newline/CR/Unicode names, zero records and manifests; strict/quiet/status/ignore-missing; cwd-relative paths; Perl shasum verification; native zero records; bit-at-a-time POSIX CRC plus installed cksum. |
| `compression-paths.test.ts` | Native-backed symlink-plus-dot-dot selection, keep/remove behavior, protected sibling files, and canonical overlap. |
| `compression.test.ts` | Independently assembled stored-DEFLATE gzip, optional header fields/CRC, empty/concatenated/binary members, truncation/corruption, native decoding of large virtual archives, force/keep/output safety, append races, quota and failure cleanup. |
| `lifecycle.test.ts` | All eleven commands against output-quota sinks, blocked input/output cancellation, late rejections, source cleanup, and empty-only compression input. |
| `pipelines.test.ts` | Seven-stage transcoding, appended gzip members, manifests, corruption/pipefail, decompression expansion quotas, and existing-output safety. |

The actual staging ceiling is exercised: 257 compressed one-MiB members expand
through a non-retaining virtual writer. Exactly 256 MiB reach the writer before
`EFBIG`; original archive/destination survive and staging entries are removed.
The test does not retain a 256 MiB result or establish external-provider durability.

Native tests execute only fixed reviewed commands/argv and fixed Python standard-
library programs. Each run uses a fresh isolated temporary directory, clean
environment, five-second deadline, eight-MiB output limit, and resulting-file
snapshot. Fixture/symlink targets are confined to that directory. Malformed
inputs are data, not executable programs. Test execution uses no network or
dependency installation. Optional pinned GNU reference builds were downloaded,
verified and compiled in temporary tooling directories; production code never
invokes native tools. See `GNU-ORACLE.md` for provenance and reproduction.

## Observed references

On August 26, 2026, Node v22.22.2 on Darwin:

- `/usr/bin/gzip`: Apple gzip 479.
- `/opt/homebrew/bin/python3`: Python 3.14.7, standard-library base64/base32.
- `/usr/bin/shasum`: 6.02, SHA-1/SHA-256 manifest/status checks.
- `/sbin/sha256sum`, `/sbin/sha1sum`, `/sbin/md5sum`: Darwin 1.0.
- `/usr/bin/base64`: BSD `--break`/`-b` dialect, not GNU.
- `/usr/bin/xxd`: Vim 2025-08-24; `/usr/bin/cksum`: system POSIX CRC.
- Temporary verified GNU builds: gzip 1.14 and coreutils 9.7.

Darwin digest generation does not escape problematic names like the target
format; NUL-delimited records compare exactly. Perl shasum accepts escaped
manifest inputs but prints literal status filenames, so native status comparisons
use ordinary/space-containing names. Escaped output and MD5 verification also
have fixed independent vectors; the later GNU run additionally verifies the
five previously unavailable coreutils command groups. BSD base64
wrap tests map `-w` to `-b`; wrap-zero terminal-newline differences are not
presented as exact parity.

## Resolved GNU/Apple dialect evidence

The five original GNU-only checks now execute against pinned coreutils 9.7.
Five additional always-runnable reference groups preserve 55 native observations
without requiring installed GNU tools. Live-oracle skips remain explicit when
the optional binaries are absent; they are not counted as passes.

The four previous Apple-equality TODOs are resolved against GNU gzip 1.14,
the requested target dialect. Apple observations remain independently tested:

| Input/mode | Virtual / selected GNU gzip 1.14 | Apple gzip 479 |
| --- | --- | --- |
| Empty stdin, `-dfc` | Success, empty passthrough | Status 1, unexpected EOF |
| One-byte `0x1f`, `-dfc` | Success, byte passthrough | Status 1, unexpected EOF |
| Zero padding after a member, `-t` | Success | Status 2, trailing-garbage warning |
| Reserved header flag, `-t` | Status 1, rejected | Success |

`gnu-evidence.json` preserves exact input hashes, native output and version/hash
identities. `GNU-ORACLE.md` documents primary-source SHA256/signature verification.
The chunked rerun exposed a genuine zero-padding premature-close bug, separate
from Apple's dialect. Framed raw-DEFLATE streaming fixes it and GNU warning-2,
zero-prefix garbage, forced suffix passthrough and forced-test behavior.
`gnu-gzip-boundaries.json` preserves 47 further native observations, including
safe output publication and input removal/retention under warning status.
The separate decoder regression commit replaces the former stricter-than-GNU policy
with pinned GNU 9.7 EOF padding and partial-output behavior. Its 134 additional
native observations run at four chunk widths; partial bytes do not imply valid
input, and pipefail remains nonzero after invalid unused bits.

## Results

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/bytes-stress/*.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/bytes/plugin.test.ts tests/commands/bytes/*/*.test.ts tests/commands/bytes-stress/*.test.ts
```

- Reproduced original baseline: **228 tests: 223 passed, five skipped**.
- Initial independent run: **94 tests: 90 passed, four TODO differences**.
- Initial combined run: **322 tests: 313 passed, five skipped, four TODOs**.
- GNU-enabled gzip checkpoint: **376 tests passed, zero failures, skips, TODOs or
  cancellations**. All five formerly absent GNU tests ran. The independent
  portion is **149 tests passed**; one old author error-1 suffix assertion was
  replaced by the exact GNU warning/publication matrix, not disabled.
- Final GNU-enabled run after decoder fixes: **381 passed, zero failures,
  skips, TODOs or cancellations** (154 independent tests, 227 author tests).
  The decoder's 134 native vectors run at four chunk widths; 256 additional
  deterministic native mutation probes also passed. No unsupported label was
  added to explain a mismatch.
- With the optional GNU environment variables unset: **373 passed, eight
  external-oracle skips, zero failures/TODOs**. Five skips are the original GNU
  checks; three are the new pinned live-replay groups. All 240 frozen GNU
  observations remain exercised. These skips are not passes.
- Repeated 26 cancellation cases five times under strict rejection handling:
  **130 additional passes**.
- Strict scoped typechecking of every byte source, author test, and independent
  test passed with repository compiler flags. `npm run build` passed.
- Whole-repository `npm run typecheck` passed at the gzip checkpoint. The final
  decoder rerun encountered an unrelated concurrent TS2322 at
  `tests/integration/adapter-tools/matrix.test.ts:46`: a sink returning `void`
  instead of `Promise<void>`. Scoped byte types and the product build pass;
  no integration-test source was edited by this worker.

Virtual tests use MemoryFileSystem and proxy adapters. Real/S3/WebDAV/mount/
overlay streaming, permissions, atomic publication, races, cleanup, and durable
storage still require provider-specific execution. A writer that ignores abort
and never settles can block cleanup; there is no forced host-termination promise.
Stdout has no command-owned total cap: sink/Shell quotas are tested separately
from the 256 MiB staging cap. This audit establishes neither complete GNU
compatibility nor product-wide superiority or performance against another shell.
