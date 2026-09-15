# Safe Python

`@poe-code/safe-python` is a private workspace package implementing a synchronous
Python interpreter, source analysis and compilation, and codec support. Its
public entrypoint is `src/index.ts`; build output is `dist/index.js` with TypeScript
declarations. This README describes the current API, not a claim of complete
Python or standard-library compatibility.

## Session API

`PythonSession` provides `exec`, `eval`, `createNamespace`, `value`, `globals` and
`close`. Container and instance handles belong to their originating session and
do not expose host storage. Calls retain guest mutations even when a guest error
occurs. Fatal termination permanently ends the session; `close` invalidates
handles without executing guest finalizers. Host services cannot reenter a session.

`PythonSessionOptions`:

| Option | Meaning |
| --- | --- |
| `limits.maxSteps` | Cumulative cooperative operation budget. |
| `limits.maxAllocatedBytes` | Cumulative charged allocation, including temporary buffers; not live heap size. |
| `limits.maxDepth` | Required host recursion policy. |
| `hashSeed` | Required pair of bigint SipHash key words; use fresh unpredictable words for untrusted guests. |
| `signal` | Optional cancellation signal, observed at checkpoints. |
| `output.write`, `output.flush` | Explicit text output services. |
| `input.readLine` | Explicit text line input, including its line ending, or `null` at EOF. |
| `warning` | Receives category, message, filename and optional source position. |
| `unraisable` | Receives the exception and associated guest object. |

Limits cover initialization, compilation and all calls in a session. Cooperative
checkpoints do not preempt indivisible host operations or yield the host event
loop. The session grants no ambient filesystem, streams, clock, randomness or
host globals. Missing capabilities produce explicit failures.

`exec` and `eval` accept text or source bytes. Their `PythonRunOptions` are
`filename`, `optimize` (`0`, `1` or `2`), `globals` and `locals`. Results distinguish
`ok`, `exception`, `diagnostic` and permanent `terminated` states. `eval` returns
a session-owned value on success. Namespaces provide `get`, `set`, `delete` and
`names`.

## Analysis and compilation

The entrypoint also exports `PythonSource`, `PythonSyntaxError`, `lex`,
`parseExpression`, `parseModule`, `analyzeExpression`, `analyzeModule`,
`compileSourceProgram`, `CodePointString`, and their public types.

`LexerOptions` exposes `futureFlags`, `meter`, `enterRecursiveCall`, `filename`,
`onWarning`, `onComment`, and tokenizer recovery state
`tokenization.syntaxOnly` / `tokenization.implicitNewline`. The meter accounts
for cooperative parser work; `enterRecursiveCall` returns a restoration callback.

`SourceCompilationOptions` exposes required `stripDocstring` and
`enterRecursiveCall`, optional `optimize`, `filename`, `futureFlags`, `onComment`,
`onWarning`, `mode` (`exec` by default or `eval`), `decodeSource`,
`sourceDecodeRecovery` and `sourceException`. A compilation filename can be a
string or a `{ displayName, value }` guest identity. Compilation takes explicit
constant adapters and an execution meter. Adapters must account for their own
guest allocations. Source decoding and exception services are explicit host
integrations; compilation does not resolve ambient files or imports.

## Environment and development

The package defines no runtime environment-variable configuration. Configure
sessions and compilation through their explicit options and callbacks.

From the repository root:

- Build the selected workspace closure: `npm run build:workspaces -- --workspace=@poe-code/safe-python`.
- Run its maintained tests: `npm run test --workspace=@poe-code/safe-python`.
- Type-check: `npm run typecheck --workspace=@poe-code/safe-python`.
- Regenerate Unicode data: `npm run generate:unicode --workspace=@poe-code/safe-python`.

Retain `UNICODE-LICENSE.txt` and `CPYTHON-LICENSE.txt` with the generated data.
