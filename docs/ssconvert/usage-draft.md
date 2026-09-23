# ssconvert usage

The spreadsheet conversion SDK is distributed through `poe-code/ssconvert`.
This workspace remains private and is not published separately. The examples
below require explicit engine configuration and document supported limits.

The domain workspace requires Node.js 22 or newer and uses TypeScript ESM with
NodeNext imports. This audit executes Node.js 22.22.2 on Darwin arm64; it does
not qualify every newer Node version, the Linux reference host, browser or
Worker realm. The native Linux profile is an oracle identity, not evidence
that those JavaScript runtime cells passed.

## Convert spreadsheets

The TypeScript ESM engine targets Gnumeric 1.12.61. Safe Bash's opt-in virtual
command calls the same createEngine/runCommand implementation as the SDK.
Built-in providers exist: `codecs: []` retains them. Supplied codecs extend or
replace service bindings. Native ssconvert is a separate QA oracle, never a
product dependency or fallback. Listed services do not establish complete
format, version, record, formula, numerical or rendering fidelity.

BIFF7/8 XOR-obfuscated and BIFF8 RC4/CryptoAPI Excel workbooks using the
native reader's built-in `VelvetSweatshop` password open automatically.
Other BIFF passwords and encrypted OpenDocument imports use an explicit
host `password.read` callback. ODF accepts UTF-8 strings or bytes, AES128/192/256 or Blowfish-CFB8,
SHA1/SHA256 start keys and prefix/full checksums. Every encrypted member is
admitted before the callback and verified before conversion. Conversion exports
plaintext. BIFF ciphers and ODF encryption checksums do not authenticate workbook data;
prefix checksums cover only the first 1024 compressed bytes. Encrypted exports
remain unsupported. No ambient password acquisition or native fallback occurs.

```ts
import { createEngine } from "poe-code/ssconvert";
const engine = createEngine({
  codecs: [],
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: {
    inputBytes: 1_000_000, outputBytes: 1_000_000,
    cells: 10_000, sheets: 16, operations: 100
  }
});
const chunks: Uint8Array[] = [];
try {
  const result = await engine.convert({
    input: { kind: "stream", source: [new TextEncoder().encode("a,b\n1,2\n")] },
    importType: "Gnumeric_stf:stf_csvtab",
    exportType: "Gnumeric_stf:stf_csv",
    destination: { kind: "stream", sink: {
      async write(bytes) { chunks.push(new Uint8Array(bytes)); }
    } }
  }, { signal: new AbortController().signal });
  console.log(result.exitCode, result.diagnostics);
} finally {
  await engine.dispose();
}
```

The private workspace also exports `@poe-code/ssconvert` after building.
Inspect installed IDs through `engine.listServices("read" | "write")`.

BIFF7/8 imports preserve indexed local and global named expressions. In the
native formula grammar, `=[]Rate` explicitly selects the workbook-global
`Rate`, even when the current sheet defines another `Rate`. This namespace
does not invoke an external-workbook resolver. Global qualification in ODF
output remains explicitly unsupported.
Custom-function token 255 accepts string and local indexed name suppliers,
including known `_xlfn.` and `_xlfnodf.` extensions. Unknown function names
remain placeholders; this does not load native plugins or grant host access.
BIFF7/8 add-in name tables use their declared container or SUPBOOK. Function
symbols call only the engine's configured functions; unlinked names used as
values yield `#REF!`. Existing linked `#NAME?` placeholders retain their
identity when a declaration supplies their expression. BIFF8 external cell and
area links calculate to `#REF!` instead of substituting their imported cached
values. The cache and raw SUPBOOK records remain retained; conversions never
fetch linked workbooks. External workbook binding and export, external names,
DDE/OLE and built-in EXTERNNAME records remain separately unsupported.

## Virtual command

```ts
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { ssconvertCommands } from "@poe-platform/safe-bash/commands/ssconvert";
const fs = new MemoryFileSystem();
await fs.writeFile("/input.csv", new TextEncoder().encode("a,b\n1,2\n"));
const shell = new Shell({ fs }).use(ssconvertCommands({
  codecs: [],
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: {
    inputBytes: 1_000_000, outputBytes: 1_000_000,
    cells: 10_000, sheets: 16, operations: 100
  }
}));
try {
  const result = await shell.exec(
    "ssconvert -T Gnumeric_stf:stf_csv /input.csv fd://1"
  );
  console.log(result.exitCode, result.stdout, result.stderr);
} finally {
  await shell.dispose();
}
```

Use `--list-importers`, `--list-exporters`, `--list-image-formats` and
`--help` to inspect command bindings. Select import/export services with
`-I`/`-T` and encoding with `-E`. Supply exporter options with `-O`; if repeated,
the CLI uses the last string, as a scalar parser option. The SDK exportOptions
array is applied in order; use a single final string to mirror that CLI input.
Conversion also exposes recalc, ordered updates, merge, split, resize, range,
graph/clipboard export, goal seek and solver/analysis operations subject to
capabilities and recorded limits. SDK counterparts are in ConversionRequest,
MergeRequest, exportGraphs and exportClipboard. runCommand accepts string or
raw byte argv, an engine, cancellation and awaited stdout/stderr sinks.

## Configuration, environment and resources

Environment, locale and timezone are explicit engine inputs. The engine does
not read ambient host files, credentials or environment. Safe Bash binds the
invocation's exported environment and cwd, retaining host-supplied locale and
timezone. CommandProfile supplies captured help/version/group text,
listing/argument encoding and virtual configuration roots. Parsed `-L`/`-D`
follow the released initialized-directory behavior; they do not enable native
plugin loading.

Only injected values affect the engine; setting variables in the host process
does not configure a separately supplied engine environment. For the virtual
command, export variables in the shell invocation; its exported map replaces
the configured environment map.

| Injected variable | Behavior |
| --- | --- |
| `LC_ALL`, `LC_CTYPE`, `LC_NUMERIC`, `LC_TIME`, `LANG` | Each category selects nonempty `LC_ALL`, then its category, then `LANG`. With none supplied, use `environment.locale`; explicitly empty selections use C. Captured names are C, POSIX, C.UTF-8 and C.utf8; uncaptured runtime locales are refused. |
| `TZ` | Overrides `environment.timezone`; an empty value selects UTC. Time-dependent operations also need an injected clock. |
| `PWD` | Remains available to `GETENV`. Resource identity uses the filesystem binding's actual cwd, then explicit `environment.cwd`; legacy bindings without either fall back to `PWD`, then `/`. Safe Bash supplies invocation cwd independently. |
| `GNM_SHORTREP_FILES` | Presence, including an empty string, selects the Gnumeric XML writer's shortest numeric representation path. This is not a guarantee of complete writer parity. |
| Other names | Available to workbook `GETENV` through the supplied map; absent names yield `#N/A`. They do not authorize host access or load plugins. |

Diagnostic URIs and VFS reads/writes use the same captured actual cwd even when
guest `PWD` names a distinct directory, is relative or is absent. The exported
environment is preserved. Logical symlink-equivalent PWD and Windows behavior
remain unverified; a supplied actual cwd must be absolute and contain no NUL.

Resource I/O requires injected filesystem bindings. createResourceIO resolves
VFS paths, file URIs, explicit fd:// descriptors and named adapters.
HTTP requires an injected authorize/request transport and redirect bound.
Authorize every hop; request hooks must not follow redirects or use ambient
credentials. Safe Bash supplies stdin/stdout descriptors and its configured VFS.
Mocked adapter success does not qualify deployed service behavior.

Required limits bound input/output bytes, cells, sheets and operations.
Optional limits cover argument/terminal bytes, compression/inflation, ZIP
entries/ratio, XML depth, split outputs and workbook nodes/text/work. These
host resource refusals do not redefine native file validity. Clock, random,
external references and runtime function providers require explicit bindings
when used. The engine includes supported calculation, formatting, rendering,
clipboard and analysis implementations; optional formula, formatting, rendering,
clipboard, solver and analysis bindings supply trusted host implementations.
Their presence does not establish full source parity. Matching time/random state
is required for reproducible dependent operations.

The exported `perlSampleFunctions` binding includes `PERL_ADDER`, `PERL_DATE`
and `PERL_SED`. `PERL_DATE` returns `YYYYMMDD` using the injected clock and
timezone. `PERL_SED("abc","b","d")` returns `adc`; replacement text stays
literal, including `$1` and backslashes. Its bounded byte-pattern grammar covers
ordered alternatives, groups (including atomic `(?>...)`), greedy/lazy and
possessive repetition (`a*+`, `a++`, `a?+`, `a{1,3}+`), classes (including the
14 POSIX byte classes such as `[[:digit:]]`), horizontal/vertical whitespace
`\h`/`\v` and inverses, atomic newline sequences `\R`, non-LF `\N`,
explicit octal bytes (`\o{141}`, `\012`), anchors, flags
and lookahead/finite lookbehind (up to 255 bytes), with captures, ASCII named groups/references
(such as `(?<part>a)\k<part>`), numeric backreferences `\1`–`\9`, and explicit
positive/relative `\g{n}` references. Variable-width lookbehind follows the
qualified Perl 5.34 experimental output profile, including its forward capture
behavior; its native experimental warnings remain unqualified. Advanced pattern syntax and native
invalid-pattern/invalid-UTF-8 result representation remain required gaps. Supply
the binding as `runtimeFunctions` to enable these names. Without it they remain
absent. An activated native Perl 5.34.1 profile matches 645 substitution controls
and frozen-clock family controls in UTC and America/Los_Angeles; this does not
qualify every optional runtime profile. The expanded capture corpus matches
native CSV bytes but exposes an unresolved native loader shutdown failure.

`pythonSampleFunctions.PY_CAPWORDS` normalizes Python whitespace and capitalizes
whole words using frozen CPython 3.14.2 Unicode 16.0.0 data, including titlecase
expansions and contextual Greek sigma. Enable `pythonSampleFunctions` through
`runtimeFunctions`. Non-ASCII command option values also need a UTF-8
`CommandProfile.argumentEncoding`. The binding also includes `PY_PRINTF` for
Python percent formatting of scalar values and column-major arrays, with exact
binary64 decimal rounding and frozen Unicode printability for `%r`/`%a`.
For example, `=PY_PRINTF("Test: %.2f",12)` returns `Test: 12.00`.
Blank scalar references format as `0.0`; error values become Python `None`
with a loader warning. Numeric star widths/precisions require Python integers,
so spreadsheet float arguments are refused; boolean arguments are accepted.
Range-object representations remain explicitly unsupported. Sample TypeErrors
return `Python exception (<class 'Gnumeric.GnumericError'>: #VALUE!)`, matching
activated native Python 3.12.13 and 3.14.7 profiles. See the
[executed formatting evidence](python-printf-gap-proof.json).

In `ConversionRequest`, `goalSeekExpressions` and `toolTest` use the built-in
native-style protocols when no overriding binding is supplied. Structured
`goalSeek` requests require `EngineConfig.solver`; structured `analysis` requests
require `EngineConfig.analysis`. `solve` uses the supplied solver or the built-in
model validation/optimization path. These paths retain the qualification limits
in the coverage ledger.

Cancellation is cooperative; await writes and registered cleanup. Copy borrowed
chunks before retaining them. Abort cannot undo completed publication or preempt
uncooperative trusted host code. Injected JavaScript is trusted, not sandboxed
by this package. Dispose engines and shells after use.

SDK conversion errors can reject with structured `code` and `exitCode` fields;
cancellation can reject with the original injected reason. Await the operation
and handle rejection as well as returned diagnostics. The command maps failures
to exit status and diagnostic bytes: measured unknown options return 1, exporter
inference failure returns 2 before input reading, and an explicitly selected
exporter with a missing input returns 1. Existing targets remained intact in
those measured preflight cases. Completed writes cannot be rolled back merely
by observing a later cancellation.

## Compatibility and delivery limits

See final-coverage-and-delivery.json, coverage.json, function-coverage.json and
their verification reports. Scoped tests establish concrete cases only.
Remaining blockers include format/version/record closure, numerical-domain
mismatches, rendering/font fidelity, optional language/database/stream profiles
and deployed adapters. Unsupported and unmeasured cases are never passes.

Delivery requires maintained fresh build/test/lint, compiled public-consumer
and independent stress evidence, explicit source-semantic blocker closure,
matching optional profiles and README approval. This task authorizes no
commit, push or publication. Local edits, local commits, verified remote-main
delivery and successful GitHub publication must be reported separately.
