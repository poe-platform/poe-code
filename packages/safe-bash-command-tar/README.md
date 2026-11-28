# tar

Run `tar` against an injected virtual filesystem with portable byte streams. Read legacy V7 archives as well as USTAR, PAX, and GNU basic headers. Listing and extraction ignore data after the end-of-archive marker; use `--ignore-zeros` to read concatenated archives.

```ts
import { createTarCommand, tarCommands } from "@poe-platform/safe-bash/commands/tar";

const command = createTarCommand();
const plugin = tarCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createTarCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

Local CLI extraction uses a confined trusted-host view: directory identities are retained, ancestry and destination receipts are checked immediately before publication, and failed publication removes only owned staging entries. Like other trusted-host mutations, this requires an externally isolated destination tree; it does not advertise OS-atomic staging. Memory backends keep their atomic extraction contract.

Archive sources can use S3, WebDAV, or custom filesystems without retained read handles. Source checks honor scoped numeric or opaque identities and opaque version tokens, including when acquiring retained read handles. Reads without retained handles verify canonical paths, sizes, timestamps, and available version tokens before and after consumption; they cannot provide a snapshot against concurrent changes. Existing-archive replacement still requires backing identity. Creation skips missing input members with a diagnostic, writes the remaining members, and exits with status 2.

`--exclude-vcs` omits version-control metadata, and `--exclude-backups` omits backup and lock files (`*~`, `.#*`, `#*#`). `--exclude-vcs-ignores` reads `.gitignore`, `.cvsignore`, `.bzrignore`, and `.hgignore` during source traversal; CVS patterns affect only their directory, while the others also affect descendants. Ignore files remain in the archive unless excluded separately.

`--one-top-level[=DIR]` extracts beneath DIR, or beneath the archive basename without its tar/compression suffix when DIR is omitted. Existing matching member prefixes are retained; stdin archives need an explicit DIR.

`--exclude=dir/` and `--exclude=./file` normalize slash spelling. Exclusions and `--no-recursion` / `--recursion` apply to subsequent source operands, including file lists. When listing or extracting, `--no-recursion` selects the named directory entry without its descendants. `--mtime=DATE` interprets dates without a zone in the shell’s `TZ` (UTC by default); explicit zones and `@seconds` retain their absolute timestamps. Verbose listings show UTC dates to minute precision by default; `--full-time` includes seconds. Listings retain original member names with `--strip-components`; add `--show-transformed-names` to display stripped names, including `/` for stripped directory entries. File lists resolve relative to the active `-C` directory; `--null` and `--verbatim-files-from` may follow `-T` when no earlier decoding mode was specified.

Append, update, delete and concatenation copy retained archive ranges and stream new records into owned staging before atomic publication. A failed or cancelled mutation preserves the original archive and drains admitted operations before cleanup. Large mutations need an injected external backend with retained reads, staged writes, cleanup and conditional publication; using a memory filesystem still keeps backing file contents in RAM.

`-I PROGRAM` and `--use-compress-program=PROGRAM` select the built-in `gzip`, `bzip2`, `xz`, or `zstd` codec for creation and extraction. A level from `-1` through `-9` is supported, for example `tar -I 'gzip -9' -cf archive.tgz file`. Other programs and arguments are rejected; no host process is launched.
