# Independent two-site retained-byte holdout

Frozen matrix: 34 rows; 20 curl and 14 jq. This verifier owns no product source.
Independent vectors use nonzero-offset Buffer/native Uint8Array views, ragged
chunks, empty chunks, next-read reuse and finalizer zeroization. No producer
mutates yielded bytes concurrently. Pipeline emitter writes are awaited.

Curl: 307 and 308 body-preserving redirects and explicitly configured supported
503 retries, each with Buffer/native and stdin/mixed stdin+VFS inputs. Eight
guards cover hop denial, cross-origin credential/custom-header stripping,
HTTPS downgrade, redirect URL credentials, replay buffer/upload limits,
retry authorization and cooperative input cancellation. Response disposal,
transport retirement, stream finalization, request bodies and authorization
order are independently asserted. Shell pipeline exit status follows the last
command: curl guard statuses are asserted in its exact numeric diagnostic, not
incorrectly demanded from the successful relay. This does not claim native curl
parity, rollback or settlement of opaque host work.

Jq: Buffer/native program streams against JSON, raw, null and actual-pipeline
stdin; exact/excess source limits, typed reader error, invalid UTF-8, input byte
limit and cancellation. Reader-error/limit checks preserve error precedence and
do not read input before a valid program. No regex probes or real network.

Execution must archive committed source, compile with existing TypeScript,
npm-pack and move the tarball, extract into an isolated public consumer, and
authenticate both import resolution and loaded module bytes. Fixture and source,
build/package hashes are captured before and after. Historical packed21/24 and
directcurl1/2 inputs and assertions remain untouched, including the known abort
fixture defect. No historical assertion is accepted or migrated by this matrix.

Scope: synthetic transport/VFS only, no deployed provider, broad gate, command
inventory, performance or superiority claim. Runtime dependency/config/root
files remain untouched. No owned servers or workers are started by the matrix;
the driver owns only its exact build/pack/test child processes.
