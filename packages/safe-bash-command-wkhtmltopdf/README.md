# wkhtmltopdf command and SDK

Use the opt-in HTML-to-PDF invocation parser and bounded byte adapter through
`@poe-platform/safe-bash/commands/wkhtmltopdf`. **No renderer is included.**
Conversion requires an explicitly supplied trusted first-party static renderer;
otherwise it rejects with `UNSUPPORTED_CAPABILITY` before opening inputs.
This workspace is private, has no external runtime dependencies, and is bundled
with its declarations into the Safe Bash artifact. Do not install it separately.

| API | Use |
| --- | --- |
| `wkhtmltopdfCommands({ limits, renderer? })` | Register with `shell.use(...)`; omitted options use bounded defaults |
| `createWkhtmltopdfCommand(options)`, `wkhtmltopdfCommand` | Configured or default command definition |
| `runWkhtmltopdf(context, options)` | Same arguments, cancellation and destinations as the CLI |
| `parseInvocation(argv, options)`, `tokenizeBatchLine(line, options)` | Bounded parsing without I/O or shell evaluation |
| `switches`, `wkhtmltopdfLimits` | Exact flag dispositions and default limits |
| `conversionOutcome`, `planPageSequence` | Source-derived statuses and physical/logical page accounting |
| `withResources`, `requireRendererFeatures` | Explicit bounded resources and feature admission |

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

Information commands work without a renderer:

```sh
wkhtmltopdf --help
wkhtmltopdf --extended-help
wkhtmltopdf --version
```

With an approved renderer binding registered, conversion forms include:

```sh
wkhtmltopdf --disable-javascript /input.html /output.pdf
wkhtmltopdf --disable-javascript cover /cover.html page /body.html /out.pdf
wkhtmltopdf --disable-javascript - -
```

Paths refer only to the configured VFS; `-` selects stdin/stdout. Output is
renderer-produced PDF bytes, UTF-8 help/version text, or stderr diagnostics.
The SDK additionally returns a typed result and conversion resource usage.
Single-job loader outcomes preserve HTTP 404 → 2, HTTP 401 → 3, other failures
→ 1; batch jobs stop on the first failure with status 1. No renderer fidelity,
PDF validity or WebKit compatibility is established by adapter tests.

[Exact supported flags](FLAGS.md) lists all 122 source switches, short aliases,
scopes, operand counts and rejections. Admitted settings require renderer support;
resource/harness/excluded flags reject even with a binding. TOC conversion and
batch HTML stdin reject. Help, extended-help and version execute; other information
actions reject. Long flags require separate operands; `--key=value` and attached
short numeric operands reject. The adapter deliberately accepts conventional `--`.

| Default bound | Value |
| --- | ---: |
| Arguments / UTF-8 argument bytes / objects per job | 1,024 / 65,536 / 64 |
| Parser work per job | 1,048,576 |
| Resource input / decoded / retained bytes | 16 MiB / 16 MiB / 32 MiB |
| Resource work / count | 67,108,864 / 128 |
| PDF output bytes / chunks across jobs | 16 MiB / 65,536 |
| Batch jobs | 128 |

Limits must be positive safe integers. Work and retained-byte accounting are
explicit ledgers, not CPU or heap measurements. PDF bytes stage in bounded memory
before publication. VFS file reads require bounded handles; file publication
requires conditional writes, distinct canonical identities and no final symlink.
Shell redirects may truncate files before command rejection.

Runtime profile: TypeScript ESM, Node.js >=22, byte streams, explicit cancellation
and invocation cleanup. No host executable, native/WASM fallback, ambient files
or fonts, implicit network, dynamic script execution or dependency downloads.
Trusted supplied bindings must honor cancellation and limits; they are not
sandboxed. Browser/workerd condition checks establish imports and declarations,
not actual workerd execution or checkpoint/replay guarantees.

Semantics derive from source commit
`024b2b2bb459dd904d15b911d04c6df4ff2c9031`, not a qualified patched-Qt binary.
See [detailed runtime and safety contracts](RUNTIME.md) for numeric/encoding
validation, cover/cloning, batch parsing, resource ownership, cleanup and deliberate
deviations. Static settings are never a claim of full browser parity.
