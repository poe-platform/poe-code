# Remaining retained-byte consumers: pre-execution freeze

Only this new subtree is owned. Production, original 17/20 histories, accepted
bounded fixes, prior verifier and all other tests/evidence remain read-only.
Candidate: `656ee2b04aa91b1cc40da865173be1b472a2c4ce`. This is not Curie's combined gate.

During preparation, other owners advanced live HEAD to
`61fe8ff8952d8b9575a991db13007a5cdc528158`: src/manifest/config bytes are identical
to the candidate, while AGENTS.md and README.md changed. This documentation drift
is recorded separately in freeze.json; the original candidate is NOT rebaselined.
Its original README is packed. Live source/document hashes must remain identical
to the separately recorded pre-execution live inventory throughout this run.

## Declared matrix: 24 rows

Each paired route runs once with a nonzero-offset Buffer view and once with a
nonzero-offset native Uint8Array view. Both reuse backing storage only after the
generator resumes, include an empty view, and zero the window in its finalizer.
Consumers must not modify the borrowed source; guard bytes and pre-resume bytes
are checked. The transport copies request chunks synchronously before pulling
again and NEVER modifies received request body buffers. No transfer API is used.

| Route | Rows | Frozen output/effect |
| --- | ---: | --- |
| jq raw slurp, named VFS | 2 | A/euro/replacement/newline/B/replacement/( plus newline |
| jq JSON slurp, actual jq pipeline | 2 | compact array with euro/replacement and second numeric object |
| jq `-f` program-file retention | 2 | `.x` program over immutable `{"x":7}` gives `7\n` |
| rg fixed before/after context | 2 | exact before/hit/after lines from named VFS |
| rg `-a -F hit` raw binary selection | 2 | selected line retains FF, NUL, C3 28 bytes |
| tar plain named archive extraction | 2 | only `/out/payload` added, bytes A0 FF 00 C3 28 0A |
| tar gzip named archive extraction | 2 | same extraction effect; explicit `-z`, no filename guessing |
| tar named payload creation pipeline | 2 | actual tar-to-tar pipe; same extracted payload |
| curl injected response download | 2 | only `/download` added, exact binary payload |
| curl injected VFS upload | 2 | PUT body exact binary payload, one authorization/dispose |
| curl mixed stdin/VFS 307 replay | 2 | POST body `S&` + binary payload on BOTH authorized hops |
| jq cooperative abort | 1 | exact caller reason identity, empty accepted output, source closed |
| curl source error | 1 | status 56, partial A0 FF stdout, exact diagnostic, response disposed once |

All successful rows require status 0 and empty stderr. Only the explicit curl
failure row permits `curl: (56) Network transfer failed\n`. Exact bytes, commands
and vectors are literal in `vectors.mjs`/`public.mjs`; complete input/output
namespace inventories are checked. JSON/raw invalid UTF8 expectations follow
the inspected custom `decodeUtf8` replacement policy, NOT binary transparency.
rg selected-line bytes use `stdoutBytes`; the Shell's decoded display string is
not the binary oracle. Tar archive names/metadata are valid text; payloads are not.

## Static retention map

- `src/contracts/io.ts`: ByteSource is AsyncIterable<Uint8Array>; readBytes forwards
  chunks and calls next only on consumer advancement; writeBytes awaits the sink.
  The tested next-read producer lifetime is the accepted project byte convention;
  these interfaces do not state ownership transfer. No arbitrary concurrent host
  mutation guarantee is inferred. FS readFile is not mutated or reused here.
- jq `input.ts:212-288`: readChunks borrows subarrays only during the current
  source item; raw/JSON conversion uses Buffer.from and Latin-1 strings, retained
  parsed values are detached. `decodeUtf8:9` explicitly replaces invalid input.
  jq `jq.ts:77-97` readProgram instead retains `chunk.slice()` until concatenation:
  Buffer alias suspect, native Uint8Array slice copies. This distinct route was
  added during static planning, before any execution; not a common collect test.
- rg `shared.ts:75-106`: Buffer.from(data) and Buffer.concat detach retained
  pending/line/context bytes. `rg.ts` batches lines/context; `output.ts:49-61`
  builds raw selected line bytes. Fixed matching avoids pathological patterns.
- tar `stream.ts:39-97`: Reader.take/body borrow until next underlying read;
  Reader.exact immediately copies into a native array. `create.ts` yields payload
  under that lifetime; publish/Memory VFS consume before advancing. Compression
  writes await the zlib callback before requesting additional source input.
- curl `output.ts:25-46` awaits stdout/VFS writers. `body.ts:121-153` retains
  replay entries via chunk.slice(); a Buffer alias suspect. Shell InputCursor
  copies external stdin, so stdin-only reuse would miss this path. Mixed
  `--data-binary @- --data-binary @/upload` enables hasStdin caching of VFS Buffer
  chunks. No request-body mutation by a custom transport is needed or permitted.
  Network README Host contract requires one request/hop, byte preservation,
  backpressure, signal respect and disposal; this transport satisfies that scope.

## Execution and evidence discipline

Run only AFTER the freeze commit:

`node --unhandled-rejections=strict tests/stress/byte-ownership-20260827/remaining-consumers/run-packed.mjs first`

The runner git-archives frozen actual source/config/manifest, compiles with the
existing TypeScript compiler into OWNED `.work`, copies original manifest/README,
and runs real `npm pack --ignore-scripts --offline`. No live dist/config/source
write occurs. It physically moves the archive into the separate named
`remaining-byte-consumer` package, extracts with native test tooling, checks
public import.meta.resolve for root/archive/network, verifies every packed file
against the stage and hashes every loaded package module. No source alias import,
fake export or production native command is used. Package dependencies unchanged.

`freeze.json` binds all tracked src files plus manifest/config/README/AGENTS and
owned fixtures. Evidence is append-only: binding/build/pack/package/raw TAP/results.
Source, fixtures and moved package are checked before/after. A mismatch is recorded
and rejected, never silently rebaselined. Suspected bugs are not findings until
dynamic observation; confirmed observations immediately create the requested
`/tmp/byte-remaining-consumers-findings.txt` marker. Finish only this fixed matrix.

No benchmark, external server/network/upload, DNS, filename MIME guess, broad
command sweep, live-provider claim or full parity claim. Test timeouts are 15s;
non-detached children have 120s hard SIGKILL bounds (git archive 30s, marker 5s).
All Shells dispose via awaited after hooks; transport disposal/source-finalizer
counts are asserted. Strict unhandled rejections and natural child termination
are required; timeout termination is not a pass. No suite-owned polling timer,
server, or detached process is acquired. Node resource types are logged at exit.

Unmeasured: all other jq programs/dialects, rg modes/regexes, tar formats/errors,
curl forms/auth/retries/external transports, backend interoperability and timing.
Static copying/borrowing observations are not universal dynamic coverage.
