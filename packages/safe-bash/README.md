# safe-bash

Run shell scripts and command-line tools in your application against an explicit filesystem, without launching a host shell.

## Quickstart

Install in a Node.js 22+ ESM application:

```sh
npm install @poe-platform/safe-bash
```

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";

const fs = createMemoryFileSystem();
const encoder = new TextEncoder();
await fs.mkdir("/work");
await fs.writeFile("/work/names.txt", encoder.encode("Ada\nGrace\nAda\n"));
await fs.writeFile("/work/run.sh", encoder.encode(`#!/bin/sh
set -eu
sort names.txt | uniq > names.sorted.txt
printf 'Hello, %s!\\n' "$1"
cat names.sorted.txt
`));

const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
try {
  const result = await shell.exec("sh run.sh reader");
  if (result.exitCode !== 0) throw new Error(result.stderr);
  process.stdout.write(result.stdout);
} finally {
  await shell.dispose();
}
```

Output: `Hello, reader!\nAda\nGrace\n`. The script, input, and generated
`names.sorted.txt` stay in memory. Results contain `exitCode`, `stdout`, `stderr`,
`stdoutBytes`, and `stderrBytes`; use the byte fields for binary output.
Each `exec()` starts fresh shell variables, functions, and working-directory state;
filesystem changes persist in the supplied `fs`. The invocation-local `umask`
starts at `0022`, accepts octal or symbolic modes, and is inherited by child shells.
Creation modes use the filesystem's capabilities; advisory modes do not enforce
physical permissions, and the host process mask remains unchanged.

## Supported features and commands

### Shell syntax

- Quoting and escapes, variables and positional arguments, parameter expansion,
  `$(command)` and backtick substitution, arithmetic expansion, and pathname globs.
- Pipelines (`|`, `|&`), lists (`;`, `&&`, `||`, `!`), file redirection (`<`, `>`,
  `>>`), descriptor redirection such as `2>&1`, here-documents, and here-strings.
- `if`/`elif`/`else`, `case`, `for name in …`, `while`, `until`, functions,
  groups `{ …; }`, subshells `( … )` (including adjacent nested subshells),
  `[[ … ]]`, arithmetic commands `(( … ))`, and indexed arrays with arithmetic
  and relative negative element indices, including `declare -a`, `local -a`,
  and `readonly -a` array literals. The optional arrays extension adds
  member slices and lazy element default/alternate operators.
- Virtual script files through `sh`, `bash`, or executable paths; `source`/`.`
  runs a script in the current shell. `bash -n script.sh` (also `sh -n`) checks
  syntax without executing commands; `set -n` / `set -o noexec` parses the
  remaining input without execution. `set -e`, `set -u`, and `set -o pipefail`
  control failures; `set -a` (or `set -o allexport`) exports subsequent variable
  assignments to child commands, and `set +a` disables automatic export.
  Bash-profile `set -f` / `set -o noglob` disables pathname
  expansion, and `set +f` restores it. `set -C` (or `set -o noclobber`) protects existing output
  files from `>` redirection; `>|` overrides it and `>>` still appends.
  `shopt -s dotglob` includes dotfiles in globs.

Shell builtins beyond the tools below: `:`, `cd`, `pushd`, `popd`, `dirs`, `set`,
`shift`, `export`, `local`, `declare`, `readonly`, `unset`, `read`, `getopts`, `let`, `shopt`, `umask`,
`exit`, `return`, `break`, `continue`, `command`, `builtin`, `type`, `.`, `source`,
`eval`. `pwd`, `true`, and `false` also work without a command bundle.
`read -a NAME` replaces an indexed array with the record's IFS-separated fields.
`declare` supports integer (`-i`), ASCII case conversion (`-l`/`-u`), scalar
name references (`-n`), exports (`-x`), readonly (`-r`), arrays (`-a`/`-A`),
global declarations (`-g`), inherited locals (`-I`), and function inspection (`-f`/`-F`).
Each invocation starts with `umask 0022`; numeric and symbolic masks affect new
files and default directory modes through the supplied filesystem. Host umask
is unchanged and may further restrict real file modes; remote modes can be advisory.

### Command bundle

`agentCommands()` registers all **79 commands** below. They operate on the supplied
filesystem and byte streams, not host executables.

| Purpose | Commands |
| --- | --- |
| Browse | `pwd`, `ls` (including `-Q`/`--quote-name` and `--indicator-style=none/slash/file-type/classify`), `tree`, `find`, `du`, `file`, `basename`, `dirname`, `realpath` (including lexical `-s`/`--strip`/`--no-symlinks`), `readlink` (including `-m`/`--canonicalize-missing`), `which` |
| Files | `mkdir`, `touch`, `cp`, `mv`, `rm`, `rmdir`, `ln`, `chmod`, `stat`, `mktemp`. `rm --interactive=never` removes without prompting; `--interactive=always` / `-i` reads a confirmation from stdin for each removal. `--interactive=once` / `-I` prompts once for recursive removal or more than three operands. `cp -a` / `--archive` copies directory trees without dereferencing symbolic links (the virtual profile is `-RP`; GNU metadata and hard-link preservation are not implemented). `cp --preserve=mode,timestamps` copies supported metadata; `-p` also requests ownership preservation (ownership changes and symlink metadata are unsupported). `cp -d` preserves symbolic links and hard links between copied sources. `cp --attributes-only` leaves existing file contents unchanged and creates empty missing files. Unsupported requested metadata fails explicitly. `cp -b` / `--backup[=simple\|numbered\|existing]` preserves replaced files; `-S` / `--suffix` sets the simple backup suffix. `cp -t DIR` / `--target-directory=DIR` copies sources into a directory; `-T` / `--no-target-directory` treats the destination as a single path. `mv -t DIR` / `--target-directory=DIR` moves sources into an existing directory; `-T` / `--no-target-directory` treats the destination as an exact path. `cp --remove-destination` removes destination entries before copying, preserving other hard links and leaving destination symlink referents untouched. `cp -v` reports paths using the original operand spelling, including relative paths. `ln -v` / `--verbose` reports each successful link as 'target' => 'source' (hard) or 'target' -> 'source' (symbolic). `rmdir --ignore-fail-on-non-empty` leaves nonempty directories untouched without reporting a failure; with `-p`, removal stops at the first nonempty parent. `touch -d` / `--date` accepts epoch seconds (`@0`), ISO/RFC dates and the virtual `date` relative-date profile; `-t [[CC]YY]MMDDhhmm[.ss]` sets a calendar timestamp. |
| Filter/search | `cat`, `head`, `tail`, `wc`, `tee`, `cut`, `tr`, `sort`, `uniq`, `sed`, `awk`, `grep`, `rg`, `egrep`, `fgrep`. `awk` accepts `--field-separator` (`-F`), `--source` (`-e`), and `--characters-as-bytes` (`-b`); its strings and records are byte-oriented. `head` and `tail` accept `-z` / `--zero-terminated` for NUL-delimited records. `uniq -D` / `--all-repeated[=none\|prepend\|separate]` prints every repeated record; `--group[=separate\|prepend\|append\|both]` prints all records with group separators. `wc -L` / `--max-line-length` counts display columns with eight-column tab stops; UTF-8 widths use the frozen GNU/Linux C.UTF-8 profile. |
| Format/combine | `nl`, `seq`, `rev`, `tac`, `expand`, `unexpand`, `fold`, `fmt`, `strings`, `paste`, `comm`, `join`, `column`, `split` |
| Structured text | `jq`, `html-to-markdown`, `xq`, `xmllint`. `xq` converts XML to JSON and applies jq filters. `xmllint` supports `--xpath`, `--noout` well-formedness checks, `--format`, and `--c14n` with comments; DTDs and schema validation are unsupported. [XML modes and limits](docs/XML_QUERY.md). `jq -S` / `--sort-keys` sorts object keys recursively in JSON output. |
| Bytes/checksums | `base64`, `base32`, `xxd`, `od`, `md5sum`, `sha1sum`, `sha256sum`, `cksum`. `od --strings[=MIN]` / `-S[MIN]` prints NUL-terminated strings with at least MIN characters (default 3). |
| Archives | `gzip`, `gunzip`, `zcat`, `tar`, `zip`, `unzip`. ZIP inspection supports `unzip -Z -1 ARCHIVE [FILES...]` for names only and `unzip -z ARCHIVE` for the archive comment, without extracting members. Other ZipInfo formats are unsupported. Tar supports gzip (`-z`), bzip2 (`-j`), xz (`-J`), suffix-selected creation (`-a`), and compression detection when reading. Creation accepts `--mtime=@SECONDS` or ISO/RFC dates, numeric `--owner`/`--group`, and octal `--mode`; `--atime-preserve[=replace]` restores source file and directory access times on timestamp-capable backends. Extraction accepts `--touch`/`-m`, `--same-permissions`/`--preserve-permissions`/`-p`, `--no-same-permissions` (virtual 022 mask), `--no-same-owner`, and directory restoration policies. Special permission bits remain stripped; ownership restoration (`--same-owner`), name lookup, symbolic modes and no-atime reads (`--atime-preserve=system`) are unsupported. `--full-time` shows UTC timestamps in verbose listings. Extraction supports `-k` / `--keep-old-files` (preserve conflicts and return status 2), `--skip-old-files` (preserve silently), and `--overwrite` (default safe replacement); the last policy wins. Existing directories are merged. Path, symlink and input-archive safety checks apply to every policy. |
| ZIP archives | `zip`, `unzip`. `unzip -n` preserves existing regular files without prompting; `-j` flattens paths and skips directory entries. Selection uses original archive names. Overwrite, traversal, symlink and backend capability checks still apply. |
| Script helpers | `echo`, `printf`, `true`, `false`, `test`, `[`, `env`, `printenv`, `xargs`, `expr`, `date`, `sleep`, `timeout` |
| Changes/review | `diff`, `patch`, `apply_patch` |

Tar creation also accepts `--sort=name` (bytewise directory-child order; operand order stays unchanged), `--sort=none` (default), `--dereference` / `-h` (archive symbolic-link targets), and `--exclude-caches` (retain directories with a valid `CACHEDIR.TAG` and their tag files, omitting other contents). Dereferencing retains backend containment and output-archive checks and rejects directory cycles.

Tar reads newline-delimited exclusion patterns with `-X FILE` / `--exclude-from=FILE`. When listing or extracting, `--wildcards` enables anchored glob member selection; `--no-wildcards` restores literal selection. `--occurrence[=NUM]` selects only the requested occurrence of each member operand (default 1), and requires member operands.

Use `cat --help`, `grep --help`, `rg --help` or `tar --help` to discover supported options.
`factor --exponents 72` prints `72: 2^3 3^2`; without operands, it reads numbers from stdin.
`zstd`, `unzstd`, and `zstdcat` accept `-q` / `--quiet`, including combined
short options such as `-qc`. Repeating quiet suppresses processing errors on
stderr while preserving failure exit codes and validation.
Use `grep -A NUM`, `-B NUM` or `-C NUM` to include lines after, before or around each match; separated groups use `--`, and `-n` marks context lines with `-`.
Use `grep -r` to search directories, with `--include`, `--exclude`, `--exclude-from` and `--exclude-dir` to filter basenames. `-R` follows nested symlinks; recursion is bounded to 128 levels and detects ancestor loops. `-b` prints byte offsets, `-Z` uses NUL after filenames, and `--no-group-separator` hides context separators. These options also work with `egrep` and `fgrep`.
The default bounded `grep` matcher rejects BRE groups, intervals, backreferences
and escape extensions such as `\|`. Use `grep -E 'Remove upvote|Upvoted'` for
alternation or `grep -F -e 'Remove upvote' -e 'Upvoted'` for literal alternatives.
Exit 1 means no match; exit 2 means filtering failed. If a preceding action
succeeded, inspect its resulting state and retry only the read-only verification
before repeating the action. A configured regex executor may support more syntax.
Use `grep -w` or `--word-regexp` to match whole words with C-locale byte matching (word characters are ASCII letters, digits and underscore), including fixed strings and `-o` output.

Use `strings -s ':'` or `--output-separator=:` to separate extracted strings with custom text, including after the final string. An empty separator joins the strings.
Default `rg` accepts UTF-8 literals and bounded ASCII regex operators (`.`, anchors,
classes, groups, alternation and greedy repetition), including `-o` and match counts.
It preserves original UTF-8 byte offsets and supports case/word selection on ASCII
subjects, plus bounded ASCII globs for path and ignore filtering. Unicode case/word
selection, Unicode regex syntax, escape extensions, lazy repetition and invalid
UTF-8/NUL subjects require a configured regex executor; unsupported profiles fail
explicitly. Literal replacement, trimming, file-size limits, depth aliases and
explicit virtual ignore files are supported. `--threads` accepts a count while
execution stays serial; `--multiline` admits line-compatible searches, with
cross-line patterns still rejected by the bounded matcher.

`/commands/fmt` exports `parseFmtArguments`, the pure byte coroutine
`createFmtEngine`, and equivalent `fmtCommand({ limits?, profile? })` /
`fmt(context, { width?, goal?, crown?, tagged?, split?, uniform?, prefix?, files?, limits?, profile? })`
execution APIs, with literal byte `arguments` available as an alternative to typed
formatting options. `fmtCommands({ limits?, profile?, replace? })` registers an
explicit plugin. Formatting defaults to GNU coreutils 9.10 byte lengths and
bounded paragraph optimization;
an explicit historical 8.30 profile retains its older width boundary. Supports
`-w`, `-g`, `-c`, `-t`, `-s`, `-u` and `-p`; for example,
`printf 'aa bb cc dd ee' | fmt -w8` produces `aa bb cc\ndd ee\n`. Private
implementation and declarations ship inside safe-bash. See the
[fmt contract](https://github.com/poe-platform/poe-code/blob/main/packages/safe-bash-command-fmt/README.md)
for spacing, prefix, cancellation and resource limits.

### Opt-in commands and storage

These plugins are separate from `agentCommands()`; pass them to `shell.use(...)`.

Import `csvcutCommands` from `@poe-platform/safe-bash/commands/csvcut` and pass it
to `shell.use(csvcutCommands())` to enable CSV projection. For example,
`printf 'a,b\nx,y\n' | csvcut -c2,1,2` emits `b,a,b\ny,x,y\n`.
The same subpath exports the typed SDK and bounded record/selector APIs; see the
[flags, limits and profiles](https://github.com/poe-platform/poe-code/blob/main/packages/safe-bash-command-csvcut/README.md).
Packed Node ESM consumers are verified; actual browser/workerd execution remains
unqualified.

| Command | Plugin and configuration |
| --- | --- |
| `curl`, `wget` | `networkCommands({ authorize, transport?, limits?, replace? })`: required authorization on every request, redirect, and retry. Curl's `-r/--range` requests byte ranges. Wget supports `--header 'NAME: VALUE'`, `--user-agent`, `--referer`, `--post-data`/`--post-file` and `--method` with `--body-data`/`--body-file`; body files come from the VFS and retain their bytes. Repeated wget headers replace earlier values by name; `--header=''` clears custom headers, and `NAME:` sends an empty value. Transport-controlled headers are rejected, and custom headers are dropped after crossing origins. Node uses the native HTTP transport and supports curl's `--connect-timeout` for DNS/TCP/TLS setup. Workers can inject `createFetchTransport()`, which cannot enforce a separate connection timeout. `createOriginAuthorizer([...])` provides exact origin/hostname policy; its omitted allowlist is deliberately `*` (allow all). [Options and limits](src/commands/network/types.ts). |
| `node` | `nodeCommands({ runtime, limits?, replace? })`: runs JavaScript with an injected SafeJS runtime, virtual files, and shell streams. [Usage and supported subset](src/commands/node/README.md). |
| `python`, `python3` | `pythonCommands({ createExecutor })` from `@poe-platform/safe-bash/commands/python`: supply an explicit executor for invocation-local Python, filesystem I/O and shell streams. [Executor and ownership contract](src/contracts/python-executor.md). |
| `llm` | `llmCommands({ providers, defaultModel?, replace? })`: opt-in model routing, sandbox attachments and streamed text/binary output. Includes injected-transport OpenAI and ElevenLabs reference providers. [Configuration and provider contract](src/commands/llm/README.md). |
| `wkhtmltopdf` | `/commands/wkhtmltopdf`: opt-in CLI/SDK adapter with VFS byte I/O and explicit limits. Requires a supplied first-party static renderer; none is included. `wkhtmltopdfCommands({ limits, renderer? })` and `runWkhtmltopdf(context, options)` share behavior. Exported `switches` lists all 122 flags and rejections; `wkhtmltopdfLimits` defaults to 16 MiB PDF output, 64 objects and 128 batch jobs. `--help`, `--extended-help` and `--version` work without a renderer; TOC and dynamic execution are unavailable. |
| `unrtf` | `/commands/unrtf`: opt-in `unrtfCommands({ limits?, replace? })`, equivalent `unrtf(context, { format?, file?, limits? })` SDK, and bounded `tokenizeRtf`, `extractRtf`, `renderRtf` streams. Strict UTF-8 text/HTML supports scoped font/color/emphasis and flat tables; objects, pictures and field instructions stay inert. Use `unrtf --text /document.rtf` or `unrtf --html /document.rtf` (HTML default); output is UTF-8 with no invented text separator/final LF. Accepted flags are `--text`, `--html`, `--quiet`, `--nopict`, `-n`, `--`; unsupported profiles fail with status 1. GNU personalities and picture exports remain unimplemented. Private implementation/types ship inside safe-bash; see the [flags, limits and runtime profile](https://github.com/poe-platform/poe-code/blob/main/packages/safe-bash-command-unrtf/README.md). |
| `exiftool` | `/commands/exiftool`: opt-in `exiftoolCommands({ limits? })` for uncompressed PNG text and `tIME` inspection/selected writes. Use `exiftool -j -Title /image.png`, `-csv` for union headers, or `-Title=Example` to edit with an `_original` backup. Typed SDK argv uses `createExiftoolArguments`. Defaults: 64 files, 16 MiB cumulative input/output, 8 MiB decoded and 32 MiB retained bytes. Private implementation/types ship inside safe-bash. PDF, Office, EXIF/XMP, broader timestamps, import and execute protocols remain unsupported; see the [supported profile](https://github.com/poe-platform/poe-code/blob/main/packages/safe-bash-command-exiftool/README.md). |
| `csvcut` | `/commands/csvcut`: opt-in `csvcutCommands({ limits?, replace? })` and equivalent `csvcut(context, { include?, exclude?, zero?, names?, headerless?, deleteEmptyRows?, lineNumbers?, addBom?, dialect?, filePath?, encoding?, help?, version? }, { limits? })`. Bounded UTF-8-sig byte input, comma/LF output and literal VFS paths; csvkit 2.2.0 selector candidate, permissive-v1 reader, quoting 0/3 only, no Sniffer or full Python compatibility. Defaults: 16 MiB input, 32 MiB output, 64 MiB retained, 1 MiB fields and 100,000 cells. Private implementation/types ship inside safe-bash; see the [flags, limits and runtime profile](https://github.com/poe-platform/poe-code/blob/main/packages/safe-bash-command-csvcut/README.md). |
| `csvgrep` | `/commands/csvgrep`: opt-in `csvgrepCommands({ limits?, replace? })` and equivalent `csvgrep(context, { columns, match?, regex?, file?, any?, invert?, dialect?, filePath? }, { limits? })`. Preserves CSV rows/headers with UTF-8-sig input, comma/LF output and the bounded `bounded-sequence-v1` Python regex subset; full csvkit compatibility is unqualified. Private implementation/types ship inside safe-bash; see the [supported profile](https://github.com/poe-platform/poe-code/blob/main/packages/safe-bash-command-csvgrep/README.md). |
| `fold` | `/commands/fold`: opt-in `foldCommands({ locale?, limits?, replace? })` and `fold(context, { width?, mode?, spaces?, files?, locale?, limits? })` for byte streams and literal VFS paths. Supports column, character and byte counting with a pinned Unicode 17 profile or explicit C decoding. Use `replace: true` with `agentCommands()` to replace its existing fold implementation; defaults are unchanged. Private implementation/types ship inside safe-bash; see the [supported profile](https://github.com/poe-platform/poe-code/blob/main/packages/safe-bash-command-fold/README.md). |
| `playwright-cli` | Standard browser commands, storage state, native snapshots, recordings, and traces through a host-owned adapter. Completed actions retain their live session when a failed checkpoint confirms safe cleanup. [Sessions and host capabilities](src/contracts/playwright-sessions.md). [Optional Cloudflare adapter and portable profiles](https://github.com/poe-platform/poe-code/blob/main/packages/safe-playwright-cloudflare/README.md). `installPlaywrightNetworkPolicy` from `/playwright` supports browser-native redirects with per-hop bounded host HTTP fetch and independent direct HTTP/WebSocket denial. `bindPlaywrightRoutePolicy(context, { ownsRequest, admit, fetch }, limits)` lets standard route mocks and header rewrites use that host policy, with admission before matching and bounded response leases. Cloudflare guardrails do not establish WebRTC/UDP denial or all-protocol accounting; hosts requiring those guarantees must refuse this integration. [Network policy and lifecycle](src/contracts/playwright-network-policy.md). |

`/commands/diff3` provides opt-in `diff3Commands({ limits?, replace? })`, the
equivalent `diff3(context, { files, merge?, selector?, labels?, ... })` SDK, and
pure byte report/merge/ed and analysis APIs. Its GNU 3.12 qualified profile uses
VFS files and bounded stdin spooling; private implementation and declarations
ship inside safe-bash. `diff3 -m /ours /base /theirs` emits merge bytes (flagged
conflicts return 1); the default report returns 0 for differences. `-e` emits an
ed script without executing it. GNU 3.12's `-X` is unflagged; one stdin operand
is supported in any position, and external `--diff-program` selection is refused.
The command is qualified for Node ESM; actual browser/workerd engines remain
unverified. See the [flags, limits and supported profile](https://github.com/poe-platform/poe-code/blob/main/packages/safe-bash-command-diff3/README.md).


`/commands/htmlq` exports opt-in `htmlqCommands({ limits?, replace? })`,
equivalent `htmlq(context, { selector: "p", text: true })` SDK execution (or
literal `argv`) and the inert HTML
byte-stream engine. Use `htmlq 'div > p' -t -f /input.html`; attribute, text and
HTML projections preserve pinned separators and lazy first-match removals.
Explicit engine limits and cancellation are required. Private implementation and
types ship inside safe-bash. Full HTML5 recovery, selector grammar and Rust URL
parity remain unqualified; modern `:is/:where/:has/:lang` are explicitly rejected.
Use `--attributes` (plural) for attribute output; no-match succeeds with empty
output. Scripts/styles remain inert and preserved; interior BOMs are retained
regardless of input chunking, correcting the pinned upstream defect.
Node.js 22+ is qualified; browser/workerd conditional graphs are checked
in Node, while actual engines remain unverified. See the
[supported flags and limits](https://github.com/poe-platform/poe-code/blob/main/packages/safe-bash-command-htmlq/README.md).



For example, load the optional PDF adapter to inspect its supported options:

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { wkhtmltopdfCommands } from "@poe-platform/safe-bash/commands/wkhtmltopdf";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(wkhtmltopdfCommands());
try {
  console.log((await shell.exec("wkhtmltopdf --help")).stdout);
} finally {
  await shell.dispose();
}
```

For a custom same-isolate Python JSPI host, use `createPythonJspiExecutor` from
the same Python entry with an explicit loader, precompiled Wasm modules and
pinned, authenticated runtime assets; follow the [static host recipe](src/contracts/python-jspi.md).
Native I/O uses the caller's asynchronous filesystem without workspace copying,
Node worker threads or a SAB request/reply bridge. This path is qualified with
installed public-package artifacts in local workerd, not a verified Cloudflare
deployment or a managed Python native-filesystem integration. JSPI cancellation
is cooperative; it neither preempts CPU-only loops nor establishes confinement.

Storage can be in memory, a rooted host directory, S3-compatible storage, or WebDAV,
with read-only wrappers, mounts, and overlays. Choose and configure it explicitly;
see the [filesystem guide](../safe-fs/README.md).

### Run JavaScript with SafeJS

Plug SafeJS into `node`; nothing starts a native Node.js subprocess or loads a
runtime automatically. SafeJS is the execution engine, not a separate shell command.

```ts
import { Shell, agentCommands, createMemoryFileSystem, nodeCommands } from "@poe-platform/safe-bash";
import { Budget, run, makeFsModule, declareHostOperation, parseSourceModule } from "@poe-platform/safe-js";

const fs = createMemoryFileSystem();
await fs.writeFile("/transform.js", new TextEncoder().encode(`
  import { writeFile } from "fs";
  const text = await process.stdin.readText();
  await writeFile("/result.txt", text.toUpperCase());
  console.log(process.argv[2]);
`));

const shell = new Shell({ fs }).use(agentCommands()).use(nodeCommands({
  runtime: {
    run, makeFsModule, declareHostOperation, parseSourceModule,
    createBudget: options => new Budget(options),
  },
}));

try {
  const result = await shell.exec("printf 'hello\\n' | node /transform.js done; cat /result.txt; node -p '1 + 2'");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

Output: `done\nHELLO\n3\n`.

`node -e SOURCE` evaluates a program; `node -p EXPRESSION` prints an expression.
`node FILE`, `node -`, and bare `node` accept virtual-file or stdin source.
Programs get `console`, virtual `process.argv`, `process.env`, `process.cwd()`,
`process.exitCode`, guest-owned `Buffer` bytes with string encodings and shared
views, and shell streams. Await `process.stdout.write(text)` and
`process.stderr.write(text)`; read input with `process.stdin.readText()` or
`readBytes(size?)`. These are bounded async helpers, not native Node streams.
`setTimeout(callback, delay?, ...args)` and `clearTimeout(id)` support cancellable
guest timers, including during top-level `await`. Pending callbacks finish before
the command exits and share its deadline and interpreter budgets.
`require("fs").readFileSync(path, "utf8")` reads text from the VFS before the next
guest statement; `node:fs` and named/default/namespace imports work too. An encoding
is required. Async helpers remain available through `fs.promises` and
`fs/promises`.

Import async filesystem functions from `"fs"` or `"node:fs/promises"`, or use
`const fs = require("node:fs/promises")`. `require("./data.json")` loads virtual
JSON relative to the entry file's directory, or virtual cwd for inline and stdin
source. `node --require ./setup.cjs` / `node -r ./setup.cjs` preloads virtual
CommonJS modules before the program; repeated flags run in order from virtual cwd.
Explicit `.cjs`, `.js`, and `.json` module paths share an invocation-local cache,
including nested relative dependencies, and retain source limits, interpreter
budgets, and cancellation. Other synchronous fs operations, package search,
ESM loading, `process.exit()`, and native module fallback are unavailable.
Pass `limits` for source/input/output bytes, timeout, and interpreter budgets;
see [defaults and configuration](src/commands/node/README.md#configuration).

## Wire an individual MCP tool

There is no generic safe-bash MCP server. Define each server and tool around the
specific operation it grants, then call `Shell.exec()` with fixed shell source.
For example, this server exposes name normalization without accepting arbitrary
Bash from the MCP client:

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "poe-code/safe-bash";
import { createServer, defineSchema } from "tiny-stdio-mcp-server";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const input = defineSchema({ names: { type: "string" } });

const server = createServer({ name: "contacts-tools", version: "1.0.0" })
  .tool("normalize_names", "Sort and deduplicate newline-separated names", input,
    async ({ names }) => {
      const result = await shell.exec("sort | uniq", { stdin: names });
      if (result.exitCode !== 0) throw new Error(result.stderr);
      return result.stdout;
    });

try {
  await server.listen();
} finally {
  await shell.dispose();
}
```

Install `poe-code` and the MCP transport package in that server's own project.
Choose its filesystem, command bundle, limits, and opt-in capabilities there;
do not expose caller-supplied shell source unless arbitrary shell execution is
the deliberate API.

## Add a command

A `CommandDefinition` has a name and an `execute(context)` handler. This example
adds `file-bytes`, which reports a virtual file's size without reading its contents:

```ts
import {
  Shell, agentCommands, createMemoryFileSystem, resolvePath, writeText,
  type CommandDefinition,
} from "@poe-platform/safe-bash";

const fileBytes: CommandDefinition = {
  name: "file-bytes",
  async execute({ args, cwd, fs, stdout, stderr, signal }) {
    if (args.length !== 1) {
      await writeText(stderr, "Usage: file-bytes FILE\n");
      return { exitCode: 2 };
    }
    const stat = await fs.stat(resolvePath(cwd, args[0]!), { signal });
    await writeText(stdout, `${stat.size}\n`);
    return { exitCode: 0 };
  },
};

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
shell.use({
  name: "file-tools",
  setup(host) { host.commands.register(fileBytes); },
});
try {
  const result = await shell.exec("printf 'hello\\n' > message.txt; file-bytes message.txt | cat");
  if (result.exitCode !== 0) throw new Error(result.stderr);
  process.stdout.write(result.stdout);
} finally {
  await shell.dispose();
}
```

Output: `6\n`. For a single command, use `shell.register(fileBytes)` instead of a
plugin. Duplicate names fail unless registration explicitly sets `{ replace: true }`.
Handlers receive `args`, `stdin`, `stdout`, `stderr`, `cwd`, `env`, `fs`, and `signal`;
return `{ exitCode }` with an integer from 0–255, await writes, and pass the signal to I/O.
Use `context.invoke` to call another command with literal arguments rather than
interpolating shell source. [Command contract](src/contracts/command.md).

`shell.use(middleware)` wraps command dispatch for logging or policy checks;
middleware must await or return `next()`. Plugins can also register filesystem
factories and provide a `dispose()` hook. [Plugin contract](src/contracts/plugin.ts).
For SafeJS host integration, `makeSafeJsShellModule` exposes shell execution and
`makeSafeJsFsModule` adapts the filesystem through injected runtime hooks.
[Integration contracts](src/integrations/safejs/index.ts).

## Options

### Shell and execution

| `new Shell(...)` option | Behavior |
| --- | --- |
| `fs` | Required filesystem; no implicit host access. |
| `deviceView` | `"default"` (the default) adds synthetic `/dev/null` and shadows ordinary backing files there. `"provided"` uses the supplied filesystem's paths and capabilities, including an `exec` filesystem override, without adding devices. Nested commands retain the selected view. |
| `cwd` | Initial virtual directory; defaults to `/`. |
| `env` | Initial exported variables; defaults to an empty map, with `PWD` set from `cwd`. No host environment inheritance. Never pass host `process.env` or any secret-bearing object: everything in `env` is readable by executed scripts (`env`, `printenv`, `$VAR`), and on Cloudflare Workers with `nodejs_compat` `process.env` contains the Worker's secret bindings. The shell warns only for the identical host `process.env` object, not copies, and does not filter values. |
| `commands` | Existing `CommandRegistry`; defaults to an empty registry. |
| `limits` | Resource limits listed below. |

`exec(source, options)` can override `fs`, `cwd`, and `limits`, and merge `env` for
one execution. `stdin` accepts a string, `Uint8Array`, or async byte source;
`stdout`/`stderr` accept byte sinks. Results still buffer output when sinks are
provided. Pass an `AbortSignal` as `signal` to cancel. [Option types](src/shell/types.ts).

| Limit | Default |
| --- | --- |
| `maxInputBytes` | 32 MiB per redirected input (`<`), independent of output; applies to buffered and streaming reads. |
| `maxOutputBytes` | 16 MiB |
| `maxCommands`, `maxLoopIterations` | 10,000 each |
| `maxSubstitutionDepth` | 64 |
| `maxSourceBytes` | 1 MiB |
| `maxExpansionFields` | 10,000 |
| `maxExpansionBytes` | 16 MiB |
| `maxWallClockMs` | 30 seconds |
| `maxCpuMs` | 30 seconds elapsed including waits; checkpoint-enforced, not CPU accounting or preemptive enforcement. |
| `pipeHighWaterMark` | 64 KiB |

Always call `dispose()` when finished. Shell failures normally produce an exit
code and stderr; limit violations, cancellation, and host failures can reject `exec()`.
The command budget counts compound commands and loop conditions as well as body
commands. With both work budgets set to 10,000, `while true; do :; done` reaches
`maxCommands` first. Work budgets bound execution counts, not elapsed latency.
Await execution settlement and shell disposal before closing backing storage,
including after a caller timeout; cancellation is cooperative.

Portable browser profiles restore blank tabs by default, preserving storage,
settings, tab count, and selection. Only pass `tabRestoration: 'navigate'` to
`restoreBrowserProfile` when replaying saved URLs is authorized; action URLs can
repeat effects. Use `recovery: true` to also suppress configuration and provider scripts.
Owner-bound hosts can enable `namedSessionAttachment: true` on
`createPlaywrightCli({ adapter, persistence, ... })` to support `attach NAME`.
It selects an existing live session or restores its committed resumable profile
for subsequent invocations with the same `PLAYWRIGHT_CLI_SESSION` default,
including an authenticated agent ID different from the target name. Explicit
`-s=NAME` overrides selection; `detach` retains the browser, while `close` retires it. See the
[host capability contract](src/contracts/playwright-sessions.md#persistence).

For Cloudflare Workers, start with the exported `cloudflareWorkerLimits` profile
and configure command-family buffers at no more than 8 MiB. Create a separate
`Shell`, environment object, and quota-wrapped filesystem view for each tenant or
request. Never reuse tenant state across requests; import `withFileSystemQuota`
from `poe-code/safe-fs` to bound cumulative writes, including command-initiated
copies and streaming output. Admission control and rate limiting remain host
responsibilities.

### Command configuration

`agentCommands()` accepts `replace` (default `false`), an `execute` fallback for
nested command dispatch, and `regex` worker limits. Per-family options are
`text`, `structured`, `search`, `diffPatch`, `metadata`, `archive`, `tableText`,
`streamInspection`, `streamFormat`, `split`, `timeEnv`, `tree`, `file`, `column`,
`htmlToMarkdown`, `du`, `expr`, `which`, `timeout`, and `applyPatch`.
Use the [typed options and linked family interfaces](src/plugins/index.ts) for
their individual limits and hooks, including clocks and schedulers. Family budgets
are separate from shell limits; `replace` applies across the entire bundle.

The package root exports `createBoundedRegexProvider`, `BoundedRegexProvider`,
and `BoundedRegexProviderOptions`. `agentCommands()` uses this provider by default;
pass `regexExecutor` to configure its resource limits explicitly:

```ts
import { agentCommands, createBoundedRegexProvider } from "@poe-platform/safe-bash";

shell.use(
  agentCommands({
    regexExecutor: createBoundedRegexProvider({ maxWorkers: 1, maxInputBytes: 65_536 }),
    regex: { maxWorkers: 1 }
  })
);
```

Provider limits bound pattern/input/result bytes, matches, work, allocations,
states, and active workers. `regex` configures executor queue and timeout limits.
The default provider runs cooperatively; it does not provide native-worker or
process-memory isolation. No internal-module import is needed.

### Environment variables

There are no package-specific runtime environment switches. Supply these through
`env` or set/export them inside a script; they refer to the virtual environment:

| Variables | Effect |
| --- | --- |
| `HOME`, `CDPATH`, `PWD`, `OLDPWD` | Home expansion, directory search, current and previous directory. The shell maintains `PWD`/`OLDPWD` on directory changes. |
| `PATH` | Virtual script lookup and `which`; never a host executable search. |
| `IFS` | Field splitting and `read`; defaults to space, tab, and newline. |
| `LC_ALL`, `LC_CTYPE`, `LC_COLLATE`, `LANG` | Character and collation behavior where supported; locale support varies by command. |
| `TMPDIR` | `mktemp` directory; defaults to `/tmp`, which must exist in the VFS. |
| `TZ` | `date` and `touch` timezone. `date` otherwise uses `timeEnv.defaultTimeZone`; `touch` defaults to `UTC`. |
| `QUOTING_STYLE` | `stat` filename quoting: `literal`, `shell-always`, or `shell-escape-always`. |

`getopts` starts with `OPTIND=1` and `OPTERR=1`, updates `OPTIND`/`OPTARG`, and
honors changes made in the script. `PIPESTATUS` exposes pipeline stage statuses.
`curl` does not read proxy variables, host credentials, `.curlrc`, or `.netrc`.

## Limitations

- This is a Bash-like interpreter, not full Bash or POSIX certification. No
  background jobs/job control, `trap`, `exec`, process substitution,
  associative arrays, or C-style `for ((…))` loops. `shopt` supports `dotglob`,
  `globstar`, `nullglob`, `nocaseglob`, and `nocasematch`, plus `-o` for supported
  `set` options. `extglob` can be queried, printed, or unset; enabling it is unsupported.
- Utilities implement subsets of their native counterparts' flags and behavior.
  There is no `git`, `npm`, `npx`, or fallback to installed host programs.
  The opt-in `node` command is not a general Node.js runtime.
- Plugins, filesystem adapters, and runtime providers are trusted host JavaScript,
  not sandboxed code. Real storage and network plugins grant real access; URL
  allowlisting alone does not pin DNS or prevent access to private addresses.
- Cancellation is cooperative, including `timeout`; it cannot undo completed
  effects or stop uncooperative host work. Limits do not bound total process memory.
  `timeout --preserve-status` retains the child's status; `--signal` (`-s`)
  accepts Linux signal names and numbers and sets the cancellation exit status.
  Signals use cooperative cancellation, without process signal delivery or traps;
  signal `0` lets the child finish, and `KILL` reports status 137 on expiry.
