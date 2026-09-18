# wkhtmltopdf command and SDK

Parse HTML-to-PDF invocations into global settings and independent page, cover
and TOC objects. Use `@poe-platform/safe-bash/commands/wkhtmltopdf` in the built
Safe Bash artifact. This private workspace supplies the command, SDK, parsing
and bounded I/O adapter; it supplies no HTML/PDF renderer. Conversion requires
an explicitly supplied trusted first-party static renderer binding. Without it,
conversion fails with `UNSUPPORTED_CAPABILITY` before opening inputs.

| API | Purpose |
| --- | --- |
| `wkhtmltopdfCommand` | Opt-in command with bounded defaults; rendering requires an explicit binding |
| `createWkhtmltopdfCommand({ limits, renderer? })` | Create a command using explicit limits and an optional static renderer |
| `wkhtmltopdfCommands(options)` | Register the command through a plugin |
| `runWkhtmltopdf(context, options)` | Equivalent SDK invocation with literal arguments, byte destinations and a typed result |
| `parseInvocation(argv, options)` | Parse literal Unicode SDK arguments, without `argv[0]` |
| `tokenizeBatchLine(line, options)` | Tokenize one batch line without shell evaluation |
| `conversionOutcome(completion)` | Preserve distinct single-job and batch exit statuses and structured diagnostics |
| `planPageSequence(objects, options)` | Account physical output, counted logical pages, final outline prefixes and copies from supplied layout results |
| `requireRendererFeatures(profile, required)` | Reject missing features, including independent flex and grid requirements |
| `withResources(options, run)` | Load bounded byte resources through explicit VFS, supplied-font and network capabilities or data URLs |
| `switches` | Inspect all 122 pinned switches, scopes, operand counts and capability dispositions |
| `WkhtmltopdfError` | Inspect a structured error code, option and exit status |

```ts
const job = parseInvocation(
  ["--disable-javascript", "cover", "cover.html", "page", "body.html", "out.pdf"],
  {
    limits: {
      maxArguments: 128,
      maxTextBytes: 8192,
      maxObjects: 8,
      maxWork: 16384
    },
    signal
  }
);
```

[Exact flags, aliases, scopes and operand counts](FLAGS.md) distinguish parser admission from rejected capabilities. No admitted rendering flag establishes WebKit fidelity. This package remains private and is never an installation prerequisite for packed Safe Bash consumers.

| Default bound | Value |
| --- | ---: |
| Arguments / UTF-8 argument bytes / objects | 1,024 / 65,536 / 64 |
| Parser work per job | 1,048,576 |
| Resource input / decoded / retained bytes | 16 MiB / 16 MiB / 32 MiB |
| Resource work / resource count | 67,108,864 / 128 |
| PDF bytes / chunks across jobs | 16 MiB / 65,536 |
| Batch jobs | 128 |

Factories use exported `wkhtmltopdfLimits` by default; the SDK requires explicit options. Runtime profile: TypeScript ESM, Node.js >=22, byte streams and explicit cancellation. Browser/workerd condition import controls do not qualify an actual workerd runtime, rendering engine or replay support. No executable, native/WASM fallback, ambient files/fonts, implicit network or dependency downloads are used.

With an approved renderer binding registered, command forms are `wkhtmltopdf --disable-javascript /input.html /output.pdf` and `wkhtmltopdf --disable-javascript - -`. Output is renderer-produced PDF bytes, help/version UTF-8 text, or stderr diagnostics; the SDK also returns a typed result and conversion resource usage. Without a binding, conversion rejects before input I/O.

Limits are required positive safe integers. Argument and UTF-8 input-byte limits
apply before retained parsing allocations. Work accounting covers input scans,
dispatch and retained settings/entry clones; it is not a CPU-time or heap-size
measurement. Returned settings belong to the caller, with independent furniture
and replacement arrays per object. Each call starts with fresh defaults.
Cancellation throws the supplied signal's original reason, including falsey
reasons. These synchronous APIs acquire no invocation resources and perform no I/O.

Command and SDK invocations share `runWkhtmltopdf`: supply a context containing
`args`, `fs`, `cwd`, `stdin`, `stdout`, `stderr`, and an explicit `signal`.
`registerCleanup`, shared `inputBudget` and shell-owned `argumentValues` are optional. Literal SDK
Unicode strings remain strings; branded byte arguments use strict UTF-8 with
BOM preservation. Both routes deliberately support the conventional `--`
delimiter. Grouped short flags consume separate following operands; attached
numeric operands and `--key=value` are not admitted by the pinned grammar.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { wkhtmltopdfCommands } from "@poe-platform/safe-bash/commands/wkhtmltopdf";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(wkhtmltopdfCommands());
try {
  const result = await shell.exec("wkhtmltopdf --help");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

`StaticRenderer.open` receives parsed settings, owned main-input bytes, the
invocation signal and checked limits. The binding is trusted first-party code,
not sandboxed host JavaScript. It must honor those limits and stop production
in `close()`. No browser, filesystem, network, script, font or subprocess
capability is passed to it. Source JavaScript defaults are inert metadata.
The adapter does not supply a qualified static renderer or claim WebKit parity.
TOC conversion and batch HTML stdin are explicitly rejected. Main inputs and
file destinations are literal VFS paths resolved against `cwd`; `-` selects
stdin/stdout. VFS adapters must offer bounded `openReadFile` handles and
`writeFileConditional` for file output. Canonical input/output identities must
be distinct; unknown comparisons and final output symlinks are refused. The
destination and parent are observed before input acquisition; publication
requires that observed binding, or exclusive creation when absent. No host
path or URL interpretation occurs.

PDF production uses a bounded memory stage before destination writes. The
shared resource ledger covers batch text, HTML inputs, PDF chunks and assembly,
including overlapping retained copies and copy work. Output byte/chunk limits
are cumulative across batch jobs; parser limits apply to each parse and batch
job count bounds repeated parsing. Registered cleanup drains admitted VFS work,
renderer retirement and enrolled output writes. Opaque sinks remain cooperative
boundaries. Cancellation preserves the reason; independent cleanup failures
surface. A failed conversion publishes no bytes. A cancelled or failed final
stdout write can leave partial sink effects. File publication uses the provider's
conditional operation; its atomic guarantee requires a conforming provider and
does not cover shell redirects, source snapshots or cancellation after commit.
Shell `>` may truncate its destination before the command starts, even when the
command subsequently rejects conversion.

Semantics are source-derived from wkhtmltopdf commit
`024b2b2bb459dd904d15b911d04c6df4ff2c9031`. No patched-Qt binary profile has been
qualified. A `static` switch disposition means parser admission, not renderer
support. Resource, harness and excluded switches fail explicitly; no capabilities
can be enabled through these APIs. Default JavaScript settings are recorded as
source settings only and never execute scripts.

Checked validation deliberately rejects nonfinite values, nonpositive zoom,
copies/DPI/font sizes and negative furniture spacing. Integer options are checked
decimal int32 values; float options round to binary32. Lengths use the source
unit aliases and normalize centimetres/metres to millimetres. Margin units must
match after normalization. The parser's default profile rejects both `--` and
the pinned ASCII-zero `--0...` sentinel with `UNQUALIFIED_QUIRK`;
`endOfOptions: true` admits the conventional delimiter, as used by the adapter.
NUL text is rejected. SDK Unicode strings do not establish native encoding or
numeric equivalence.

The parser's information and batch modes record settings without doing I/O.
The adapter supplies static help/version output, rejecting other information
actions, and executes bounded batch jobs using fresh settings for each line.
Batch conversion stops at the first failure with status 1. See the
[remaining engine gates](../../docs/plans/safe-bash-wkhtmltopdf-parser-progress.md).

`conversionOutcome` models the pinned source's completion handling; it does not
perform a conversion. In single-job mode a nonzero loader code overrides success:
HTTP 404 exits 2, HTTP 401 exits 3, other errors exit 1. Network codes retain the
source's 1000 offset as a separate enum value. Supply a symbolic network name from
an explicitly qualified profile; absent names remain `null`, without inventing a
Qt mapping. Batch mode uses success alone (0 or 1), with no helper diagnostic.
Codes must be nonnegative int32 values; supplied names are bounded to 128 ASCII
identifier characters. This checked admission is a deliberate safety deviation.
The API performs bounded synchronous work and acquires no resources.

Page accounting accepts actual final layout counts; it does not parse HTML, lay
out content or emit PDF. `pagesCount: false` preserves physical output and final
outline prefixes while preventing logical numbering from advancing. Collated
copies repeat the document and reset logical numbering; uncollated copies repeat
each page. Offset affects logical numbers only. `logicalTotal` excludes copies
and offset and is not a claim about native header `topage`. Zero-page objects
produce no placeholder; native preprocessing outline placeholders remain a
separate compatibility concern.

Page-sequence limits bound input objects, retained output records (including
copies) and work. Work includes admission scans, repeated object visits and
output records; output admission completes before records are retained.
Cancellation preserves the original reason. No invocation resources are
acquired. Renderer feature declarations are bounded admission data, not engine
qualification evidence. No renderer profile is supplied or enabled by default.

`withResources` requires an explicit cancellation signal and positive safe-integer
limits for input, decoded and retained bytes, resource count and work. Reads are
sequential. `load(reference, base?)` resolves against an explicitly supplied base;
only `vfs:`, `http:` and `https:` references can reach supplied capabilities.
`font(name)` uses only the supplied font capability. Host `file:` references and
ambient fonts are unavailable. No resource bytes are interpreted as JavaScript.

Data URLs accept ASCII percent-encoded bytes and strict, padded base64 with
canonical trailing bits. A plus remains a plus. Raw non-ASCII, whitespace and
percent-encoded base64 are rejected in this initial byte profile. Metadata is not
a validated MIME type or a promise that a renderer supports the resource format.

Input accounting includes reference text, optional base and normalized URL text,
plus streamed source bytes. Decoded accounting counts data bytes and received
stream bytes, including consumed bytes from failed reads. Retained accounting
includes owned resource byte arrays and peak temporary stream copies during
assembly; it is not a JavaScript heap measurement. Work charges reference scans,
data validation/decoding, stream reads (including empty chunks), copying and
assembly. No recursive parser or PDF output is involved in this API; output-byte
accounting and output publication remain open renderer/integration requirements.

Byte streams accept authentic `Uint8Array` views across JavaScript realms,
including Node buffers. Admission and copying use intrinsic typed-array slots,
so shadowed byte lengths and custom iterators cannot alter limits or payloads.
Only the view's bytes are copied; other typed arrays, data views, proxies and
objects with forged byte-array tags are rejected before decoded allocation.

Each opened lease is closed once after success, error or cancellation. Close
failures reject successful reads; a primary error, including a falsey cancellation
reason, takes precedence. The invocation cancels unfinished reads, waits for
cleanup and rejects completion with reads outstanding. Resource methods expire
when the callback finishes. Arrays already returned belong to the caller; scope
completion ends accounting, without revoking or erasing those arrays.

Capabilities are trusted, explicitly supplied boundaries. VFS opens must enforce
canonical identity authorization within their virtual namespace. Network opens
must authorize every redirect, preserve TLS validation and bound their own
transport buffering. Opens and closes must settle promptly on cancellation;
arbitrary callbacks that ignore this contract cannot be made safe by byte limits.
Supply a deadline through the cancellation signal when needed. No capabilities
are created implicitly, and the resource API does not qualify a network or VFS
provider's implementation.
