# Virtual ExifTool metadata

Inspect and edit admitted PNG text metadata in virtual files. Use the public
`@poe-platform/safe-bash/commands/exiftool` export; this private implementation
workspace is never an installation dependency for consumers.

```sh
exiftool -j -Title /image.png
exiftool -csv -Title -Author /first.png /second.png
exiftool -Title=Example /image.png
exiftool -Title= -overwrite_original /image.png
exiftool -@ /arguments.txt
```

These commands run inside the configured virtual Shell, not a host executable.
The runtime is first-party TypeScript ESM with byte-stream input/output and no
external runtime dependencies, Perl, native/WASM fallback, network access,
ambient files/configuration or downloaded code. The versioned registry qualifies
against ExifTool 13.59 source `2200871d9cef988051d2a99d67df3bda6cbb30a8`,
archive SHA256 `e1e2ad6c6fbf568afee5993ef8b2b91ab013d21698c9304e079e633ad82776f5`;
that source is a development reference, not a shipped interpreter or parity claim.

Packed Node, browser and workerd export-condition checks cover the admitted PNG
path and declarations without installed private workspaces. Browser/workerd
conditions were exercised under Node with global `Buffer` removed; actual browser
and workerd engines remain unqualified. The default Node profile requires Node's
normal runtime globals.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { exiftoolCommands, inspectPng } from "@poe-platform/safe-bash/commands/exiftool";

const fs = createMemoryFileSystem();
// imageBytes is a valid PNG supplied by your application.
await fs.writeFile("/image.png", imageBytes);
const shell = new Shell({ fs }).use(exiftoolCommands());
try {
  const result = await shell.exec("exiftool -Title=Example /image.png");
  if (result.exitCode) throw new Error(result.stderr);
  // Default writes retain a byte-identical /image.png_original backup.
  const metadata = inspectPng(await fs.readFile("/image.png"), {
    signal: new AbortController().signal,
  });
  console.log(metadata.tags);
} finally {
  await shell.dispose();
}
```

| Feature | Current behavior |
| --- | --- |
| PNG text | `tEXt`, uncompressed unqualified `iTXt`; Title, Author, Description, Comment and Copyright writes; non-ASCII writes use UTF-8 `iTXt` |
| PNG timestamp | `tIME`/ModifyDate inspection, assignment and deletion; fixed-width EXIF/ISO syntax, optional fractions and explicit offsets; native storage discards fractions/offsets without timezone conversion |
| Duplicate tags | Last repeated text value wins; `-a` emits source order; extracted tags retain raw keyword, chunk/index/offset, instance, bytes and interpreted text |
| Input | Literal VFS paths, `--` option terminator and one `-` stdin byte stream for extraction; stdin editing and repeated stdin operands are explicitly refused |
| Presentation | `-s`, `-S`, `-s3`, `-b`, `-j`, `-csv`, `-f`; text sanitization is separate from stored values |
| JSON | Conservative lexical numbers and booleans; `-api StructFormat=JSONQ` quotes every scalar; `1e999` stays lexical text in the SDK |
| Duplicate JSON | `-j -G4` distinguishes `Copy1:Title` and the primary `:Title`; lowercase `-g4` grouped output is independently unsupported |
| CSV extraction | Buffers all admitted files for union headers, preserves stored controls, quotes fields and supports `-f`; import, binary and ValueConv-qualified headers remain unsupported |
| Editing | `=`, empty deletion, matching text `-=`; scalar `+=` and temporal shifts are refused; standalone `-all=` removes text and timestamps in admitted PNGs |
| Publication | Default backup, replacement via `-overwrite_original`, identity-preserving `-overwrite_original_in_place`, exclusive `-o` destination |
| Limits | Configurable cumulative input, decoded, retained, output and algorithm work admission; explicit cancellation and invocation cleanup |
| Argument files | VFS `-@` expansion in argument order; initial BOM, physical lines, pinned whitespace/comment/CSTR rules and bounded nested includes |

Accepted flags are exactly `--`, `-config ''`, `-j`/`-json`, `-csv`, `-G4`,
`-api StructFormat=JSONQ`, `-a`, `-b`, `-f`, `-s`/`-s1`, `-S`, `-s3`, `-n`,
`-overwrite_original`, `-overwrite_original_in_place`, `-o PATH` and `-@ PATH`.
Selectors are `-Title`, `-Author`, `-Description`, `-Comment`, `-Copyright`,
`-ModifyDate` and the missing-value probe `-MissingTag`; a trailing `#` requests
ValueConv without PrintConv. Assignment forms are `-TAG=VALUE`, `-TAG=` and
`-TAG-=VALUE`, plus standalone `-all=`. Scalar `+=` is recognized but refused.
Most flags and tag names are case-insensitive; `-S` and `-G4` are case-sensitive.
No directory scanning, `-s2`, `-g4`, import or execute/stay_open protocol is admitted.

Flags have combination limits: `-o` requires one file and assignments; `-G4`
requires JSON extraction. JSON with binary output is refused. CSV cannot be
combined with JSON, binary output, assignments or trailing-`#` selectors.
`-api StructFormat=JSONQ` controls JSON serialization; it does not change stored
metadata or make CSV an import format.

Default cumulative limits per invocation are 16,777,216 input bytes,
8,388,608 decoded bytes, 33,554,432 retained bytes, 16,777,216 output bytes and
268,435,456 work units. At most 64 file operands and 4096 expanded arguments
are admitted. Override byte/work limits with `exiftoolCommands({ limits })` or
`createExiftoolCommand({ limits })`; limits must be nonnegative safe integers.

Text output uses aligned tag names by default, compact `Tag: value` with `-S`,
or LF-terminated values with `-s3`. Binary output has no final terminator.
JSON returns an array of file objects with `SourceFile`; CSV emits the union
header and file rows. Writes report updated/created/unchanged counts and errors
on byte streams. Exit status is 0 for success and 1 for an error; native status 2
for all-files-fail conditional execution is not implemented. Resource exhaustion
and cancellation may reject the direct
SDK invocation rather than return a status, as qualified below.

Replacement publication requires VFS atomic owned staging; in-place publication
requires VFS atomic conditional mutation. Existing backups stay intact. Replacement
of multiply linked files is explicitly unsupported; in-place writes preserve
the inode and update aliases on a qualified VFS. Symlink inputs are refused.

This is an initial implementation, not complete ExifTool compatibility. Compressed
PNG metadata, qualified/XMP namespaces, JPEG/TIFF, Office
inspection, broader timestamp syntax/conversions, import, extended tag catalogs and execute
protocols remain open. Known unsupported readers and writers fail explicitly.
PDF metadata removal is reversible and does not erase historical revisions or
guarantee redaction; the required PDF parser/writer is not yet implemented.
Native code evaluation, user config modules, host utilities and ambient polling
are unavailable. Only UTF-8 argv is currently admitted. `-config ''` is accepted.

Argument files must be regular UTF-8 VFS files, resolved against the invocation's
working directory. They never search an executable directory or apply shell
quoting. Cycles, more than 15 nested includes, more than 4096 expanded arguments,
`-@ -` stdin, symlink inputs and configuration/common arguments in files are
refused. File bytes, decoding, retained arguments and parsing work share the
invocation budget. Execute/stay_open and ambient polling remain unsupported.

Timestamp assignment currently accepts years 0001–9999, months 01–12, days
01–31, hours 00–23 and minutes/seconds 00–59. Relative dates, time shifts,
leap seconds and host/VFS file-time changes remain unsupported. Unsupported date
syntax fails explicitly; the full native warning/no-op policy remains open.
`-b` emits converted values without a terminator; SDK `raw` retains stored bytes.

`createExiftoolCommand({ limits })` exposes the same handler used by the Shell
plugin for direct SDK invocation. `inspectPng` and `editPng` operate on owned
byte results with mandatory signals. Limits conservatively charge transient
allocations and cumulative bytes, so an operation may be refused before its
exact final extent is known. Output limits include backups and diagnostics.
Text and binary output may already have reached a consumer when a later file,
quota or cancellation fails. JSON and CSV are buffered before emission, but sink
failure can still leave partial bytes. Conditional publication is atomic per file;
an invocation is not a transaction across files, backups and diagnostic output.
Completed writes and backups are not rolled back by later failures.

Use `createExiftoolArguments` for typed CLI-equivalent options. It returns the
canonical argument carrier; pass both fields together to the handler:

```ts
import { createExiftoolArguments, createExiftoolCommand } from "@poe-platform/safe-bash/commands/exiftool";

// context supplies the VFS, cwd, signal, byte streams and invocation cleanup.
const argv = createExiftoolArguments({
  files: ["/image.png"], tags: ["Title"], format: "json", quoteScalars: true,
}, { signal: context.signal });
const result = await createExiftoolCommand().execute({
  ...context, command: "exiftool", args: argv.args, argumentValues: argv,
});
```

Typed options cover the admitted output styles, duplicate/missing-tag policies,
ValueConv selectors, ordered assignments, overwrite policy and output destination.
File operands remain literal even when they start with `-`; `-` selects stdin.
Argument construction has its own explicit cancellation and resource bounds,
independent of command execution limits. Unsupported combinations use the CLI
parser's admission rules. Argument-file expansion remains available through raw
CLI argv. Resource exhaustion throws from the direct handler; Shell currently
maps it to an internal-error diagnostic, so failure diagnostic parity is pending.
