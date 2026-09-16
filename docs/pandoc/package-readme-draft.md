# Package README publication gate

Exact proposed contents for `packages/pandoc/README.md` follow in the fenced block.
No README has been created or edited. Root AGENTS.md requires explicit permission
for README additions; this task authorizes drafting only. The gate remains open,
so package delivery must not be reported complete. This package is private and
is not an independently published install target.

```markdown
# @poe-code/pandoc

Private TypeScript ESM conversion orchestration package. The built public exports
are `readDocument`, `writeDocument`, `convert`, `PandocError`,
`formatCapabilities` and their explicit supporting types.

There are no built-in readers or writers yet. All built-in format descriptors
report `available: false`. Operations without matching explicit capabilities
reject with `E_CAPABILITY`. This package does not invoke native Pandoc or other
executables. Format conformance, full Pandoc AST validation and the safe-bash
command are subsequent tasks; the current document model is a structural seam.

## Operations and configuration

- `readDocument(input, { from }, context)` returns an owned document.
- `writeDocument(document, { to }, context)` returns an owned serialized result.
- `convert(inputs, { from, to }, context)` reads each input independently in order,
  combines blocks/resources and applies later metadata values, then writes once.
- `input` contains `bytes: Uint8Array` and optional explicit resource `base`.
- `context.reader` contains `format` and asynchronous `read(input, adapterContext)`.
- `context.writer` contains `format` and asynchronous `write(document, adapterContext)`.
- `context.resources` optionally supplies asynchronous `resolve(id, base, signal)`.
- `context.output` optionally supplies asynchronous `publish(bytes, signal)`.
  The host must implement atomic publication and honor cancellation. Publication
  is awaited after serialization and budget checks; the engine cannot roll back
  effects already completed by a host capability.
- `context.signal` is an optional borrowed `AbortSignal`.
- `context.limits` optionally lowers the ceilings below. Unknown, negative,
  noninteger or raised limits are rejected.

| Limit | Ceiling |
| --- | --- |
| inputBytes | 33,554,432 aggregate bytes |
| resourceBytes | 67,108,864 bytes |
| outputBytes | 67,108,864 bytes |
| nodes | 100,000 structurally tagged AST objects |
| depth | 128 structural nesting levels |
| work | 1,000,000 work units |

The adapter context supplies the frozen limits, signal, bounded resource resolver
and `checkpoint(units = 1)`. Adapters must charge parsing/layout work and check
cancellation through checkpoints. Adapter implementations are explicit trusted
capabilities and remain responsible for format syntax, constructor semantics,
resource admission and format-specific budgets. This seam does not certify them.

Formats and directions follow the conversion contract. Writer `html` normalizes
to `html5`; other names are case-sensitive. Dialect switches and configuration
options beyond `from`/`to` are not implemented by this seam and are rejected.
There is no implicit inference or default format selection.

Documents contain `blocks`, `metadata` and owned `{ id, bytes }` resources.
Input bytes, documents, resolved resources, binary results and publication bytes
are copied at capability boundaries. Results discriminate `{ kind: "text", text }`
and `{ kind: "binary", bytes }`, with ordered typed `diagnostics`.
Errors use `PandocError` with a stable code and operation. Metadata key conflicts
produce `W_METADATA_CONFLICT`. No diagnostics are mixed into serialized output.

## Environment exposure

None. The engine reads no environment variables, host filesystem, ambient network,
current time or randomness. Resource and output behavior comes exclusively from
supplied capabilities. SDK limits cannot be raised through CLI configuration.

## Maintained checks

From the repository root:

- `npm run build:workspaces -- --workspace=@poe-code/pandoc`
- `npm run lint --workspace=@poe-code/pandoc`
- `npm run typecheck --workspace=@poe-code/pandoc`
- `npm run test:unit --workspace=@poe-code/pandoc`

The package has no runtime dependencies. Unit tests use original in-memory
capabilities and do not establish reader or writer conformance.
```
