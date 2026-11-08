# Binary framing schema v1 (review draft)

The companion binary-layout.json also specifies bounded control scheduling and
distinct acknowledgements. Reserve control admission independently of data credit
before native/data work; ACK and callback results cannot need credit they release.
Scheduling occurs before frame emission and cannot reorder emitted sequences.
Independent authenticated HTTP result/cancel/signal/lease routes remain usable
when output-lane delivery is blocked. Exhaustion pauses dependent work within
negotiated limits/deadlines, then reports the observed failure or unknown outcome;
it never discards frames or manufactures END. This is a design liveness requirement
without a new header field or frame kind. See ../../sdk-transport-decisions.md.

`dependency-manifest-v1` selects HTTP shapes through `admission-map.json` without
changing this 40-byte header, stream ordering or CONTROL admission. Manifest and
preparation responses carry bounded metadata; media/file payloads remain raw blob
bodies or correlated DATA/END. Dependency job submission uses the generic job/lane
lifecycle, including cancellation, recovery and delivery acknowledgements. An
inline NativeResult stdout/stderr octet array is not an alternate binary profile.

This schema is normative alongside `protocol.schema.json` and `http.openapi.json`.
The proposed portable codec export is `@poe-code/remote-execution/binary`; the server
and SDK must implement these lanes before qualification. All byte counts include zero bytes;
no payload uses base64, text decoding, JSON arrays of media bytes or implicit EOF.
Control JSON may represent bounded argv as octet arrays; media data is binary.

## Frame layout

HTTP frame lanes use `application/vnd.poe.remote-execution.v1+octet-stream`.
Each body contains consecutive complete frames; a frame can cross network chunks.
An interrupted final frame is discarded, never acknowledged. Integers are unsigned
big-endian. All reserved bits must be zero. Header length is exactly 40 bytes.

| Offset | Width | Field |
| --- | --- | --- |
| 0 | 4 | Magic octets 0x52 0x45 0x58 0x31 (`REX1`) |
| 4 | 1 | Major = 1 |
| 5 | 1 | Kind: 1 DATA, 2 END, 3 CONTROL |
| 6 | 2 | Reserved = 0 |
| 8 | 4 | Channel ID; 0 control, 1 stdin, 2 stdout, 3 stderr, ≥4 negotiated handle/blob-range channel |
| 12 | 4 | Payload byte length; at most negotiated maxFrameBytes, v1 ceiling 1,048,576 |
| 16 | 8 | Per-direction contiguous frame sequence starting at 1 |
| 24 | 8 | DATA/END byte offset in this channel, starting at 0; CONTROL = 0 |
| 32 | 8 | Correlation ID; 0 for ordinary streams, otherwise negotiated callback/read operation number |
| 40 | length | Raw bytes for DATA; zero bytes for END; UTF-8 Control JSON for CONTROL |

Use bigint internally for 64-bit fields. HTTP/control JSON represents unsigned 64-bit
values as canonical decimal strings with no leading zeros except `0`. Reject overflow
above 2^64−1 before allocation; adapter access beyond safe-fs safe-integer positions
fails explicitly. Never round offsets through Number.
Signed seek offsets in control records must be within −2^63 through 2^63−1;
reject negative zero and overflow even when the lexical JSON schema accepts them.
Control payloads have a separate
negotiated bound ≤ frame ceiling. Unknown kinds, bad magic/version, reserved bits,
unknown channel, noncontiguous sequence or offset, invalid control JSON and oversized
length are protocol errors before payload allocation/admission.

DATA is legal only on data channels, END exactly once per opened data channel, and
CONTROL only on channel 0. Empty DATA is allowed, does not advance channel offset,
and consumes frame/control budgets. END has offset equal to bytes previously sent;
transport EOF without END is interruption, not native EOF. CONTROL records do not
carry file/stream contents. Bidirectional handle reads/writes allocate a new negotiated
channel per correlated operation; ordered descriptor control operations carry cursor
semantics, not channel offsets. Stdout/stderr cannot be merged into a text log.

Session, job and epoch are bound by the authenticated HTTP route, not arbitrary header
values. Opening a lane returns a lane ID/direction and journal floor/next sequence.
The lane binding persists through reconnect while retained. POST input frames may
contain bounded batches when the client cannot stream HTTP request bodies; server
applies identical sequence rules. GET output frames streams immediately with proxy
buffering disabled. Separate input/output lanes avoid request/response deadlock.

## Acknowledgement, backpressure and replay

The receiver admits bounded bytes, awaits the destination write and sends an Ack
control record with the highest contiguous frame sequence and per-channel offsets.
It must not ack merely because network bytes arrived. A retained source chunk is
copied before advancing its producer; a transient awaited write may borrow its bytes
until completion. Max inflight bytes bounds unacknowledged data per lane and per job.
Slow consumers block native output. Replay journal capacity is finite; at its bound
pause production, then cancel by negotiated deadline, never silently drop data.

Replay repeats exact retained frames (including sequence and payload), not native
execution. Receiver drops only already durably acknowledged sequences; a conflicting
repeated frame is a protocol error. Cursor acknowledges delivery to a named consumer,
not durable external side effects. If a sink write completed but cursor persistence
was lost, SDK reports delivery unknown; it cannot claim exactly-once sink writes.
Fresh consumers may read retained output from its journal floor intentionally.
A cursor below the floor yields HTTP 410/replayGap. Never skip forward silently.

CONTROL types are Ack, ChannelOpen, Callback, CallbackResult, Effect, JobState and
Failure as specified in protocol.schema.json. Control and data ordering in the output
lane establishes observed event order; stdout/stderr cross-stream native timing is
not claimed beyond that order. Terminal JobState appears only after END for all
output channels, resolved/unknown effect barrier and owned server cleanup. The client
still awaits its sinks/local cleanup before execute settles.

The negotiated canonical-object-v1 extension also permits CanonicalCallback and
CanonicalCallbackResult from canonical-filesystem.schema.json. Exact object read/write
positions are canonical decimal within signed 64-bit off_t, independently of the
unsigned framing counters. DATA channels are scoped to callback owner, operation and
correlation; actual transferred length must equal the result acknowledgement. Handle
IDs, object IDs, open-description IDs and channel IDs are separate domains. Object
payload bytes never appear in CONTROL or Effect JSON. Replay follows the same unknown
delivery rules; a callback retry cannot blindly repeat canonical mutations.

## Raw blob transfers

Blob upload and download routes use `application/octet-stream`, without frame headers.
Upload requests supply Upload-Offset (canonical decimal), Content-Length and
Content-Digest (`sha-256=:<RFC 9530 base64 digest>:`; only the digest is base64).
The bounded HTTP body is one resumable chunk. Acknowledgement returns committedOffset;
bytes after an interrupted body are not committed. Identical replay of an already
committed chunk is accepted only with identical range/digest/bytes; conflicting or
noncontiguous chunks return 409. Commit validates total length and whole SHA-256.
Raw ranged download uses one HTTP byte range (206, Content-Range); unsatisfiable ranges
return 416. Digest/size describe the immutable full blob; clients verify requested
range integrity through TLS and optionally whole-blob digest when all bytes arrive.
No claim that a full-blob digest alone authenticates an isolated range.

## Retained append and rename receipts

Canonical append transfers its declared byte length on the operation's correlated
DATA/END channel. The host calls the admitted retained append operation; it never
chooses EOF with a separate stat. acknowledgedBytes is actual settled progress no
larger than the submitted length. A short write does not authorize blind replay of
the whole request. An uncertain tail is unknown and retains the known prefix.

Rename has no data channel. Its optional moved result comes from the canonical
operation receipt: false is a successful no-op, absence leaves movement unknown.
These metadata additions keep the same 40-byte v1 frame layout. They require
canonical callback admission and originating-operation result validation; they are
review requirements, not assertions about current codecs or native bridge support.

## Retained acquisition receipts

Canonical create is a CONTROL-only acquisition request. Its applied result includes
the retained handle/object IDs and actual creation receipt; there is no inline file
payload or data channel. Subsequent reads/writes/append allocate their own correlated
channels. Native creation/truncation effects must settle canonically before success
is acknowledged. Loss of that acknowledgement does not authorize replay; retain the
known process/effect observations and expose acquisition uncertainty independently.
This additive review record leaves the v1 header and framing counters unchanged.
