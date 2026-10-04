# Yq JSON streaming Worker QA

Status: manual qualification remains outstanding. Unit tests cover byte ownership,
backpressure, cancellation and malformed input; they do not measure Worker memory.

## Execution

1. Build the current Safe Bash Worker bundle with the optional YAML peer. Run it
   under workerd and in a Cloudflare Worker. Record revision, runtime versions,
   deployment configuration and the memory/CPU measurement tools used.
2. Inject an external safe-fs backend with streaming reads. Generate JSON records
   upstream at 1 MiB, 16 MiB, 128 MiB and 512 MiB total sizes while keeping individual
   records at 1 KiB. Do not construct the full input in the Worker or use a RAM spool.
   Instrument readFile, readStream, descriptor reads/writes and storage byte counts.
3. Run `yq -p=json -o=json -I=0 '.id'` into a slow HTTP consumer. Measure peak isolate
   memory, CPU time, time to first byte, total bytes and maximum outstanding source
   bytes. Confirm output begins before input EOF, reads stop while output is blocked,
   no payload-wide readFile occurs, and peak memory plateaus as record count grows.
4. Repeat at 1, 4 and 16 concurrent requests. Record per-request completion/first-byte
   latency, total isolate memory and failures. Confirm bounded outstanding reads per
   request; distinguish concurrency costs from input-size growth.
5. Abort after the first output, disconnect the upstream source, reject a sink write,
   and inject a filesystem read error. Verify original cancellation/error identity,
   iterator cleanup and absence of continued reads. Invalid UTF-8 and truncated JSON
   after valid records must report errors while preserving already emitted output.
6. Compare byte output, exit status, document indices, large integers, escaped strings,
   multi-document input and malformed-input diagnostics against the supported native
   yq profile. Verify in-place failures do not publish partial documents.

## Remaining qualification scope

Repeat with increasing *single-document* sizes, eval-all joins, YAML anchors/edits,
jq slurp and XML XPath queries after safe-fs-backed document/value storage lands.
Those paths are still memory-resident; the multi-document JSON result cannot qualify
them. A Node heap measurement cannot replace workerd/Cloudflare results. Store raw
measurements temporarily in `/out`, summarize verified observations in the delivery
record and remove temporary evidence after use.
