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

## XML paged-formatting qualification

Repeat the input-size and concurrency measurements for `xmllint --format`,
`--c14n` and `--exc-c14n`, using generated repeated sibling elements, comments
before/after the root, namespace declarations and mixed content. Confirm spill
writes use only the injected external safe-fs, read/write windows stay at or below
16 KiB, and scratch descriptors close after success, sink failure and cancellation.
Repeat with `--noblanks` and each supported `--encode` value, including UTF-16 BOM
and non-ASCII text. Compare output with native xmllint. Record the fixed page-cache cost separately
from the largest token and current attribute collection, which still reside in memory.
Stored document and canonical output scopes use persistent caller-backed
namespace trees; check increasing namespace counts, shadowed prefixes, default
namespace resets, and siblings reusing an inherited scope. Parser namespace scopes
share the 64 KiB source/frame cache. Individual namespace tokens and parser attribute
collections still need separate memory qualification.
Parser ancestry uses linked backing records; check deep documents with
a fixed namespace scope independently of source size. Also measure startup/first-byte latency; formatting validates
the document before publishing output.

## XML paged-query qualification

Repeat the measurements with `--xpath 'count(//item)'`, `--xpath '//item[last()]'`,
large unions, node-set comparisons and `sum` over many small values. Record query
selection writes separately from parser writes, check document order and duplicate
removal against native xmllint, and interrupt requests during selection replay.
Use a slow sink for large node-set output and verify only bounded output chunks are
outstanding. Distinguish node-count growth from individual string-value growth:
run large `string`, `concat`, `substring`, `contains`, `translate`, comparison and
numeric-coercion expressions. Include long search patterns and mapping strings to
exercise backed algorithm state. Repeat with `--nocdata` and
`--noblanks`, especially many adjacent small CDATA tokens forming one large logical
text node. Verify `count(text())`, whitespace inheritance and byte output against
native xmllint without a concatenated value in the formatting/selection path.

Also increase the size of a single CDATA section using reused Unicode chunks.
Verify one XPath node per section (including empty sections), unchanged CDATA
serialization and canonical output, bounded node metadata, and cleanup when a
fragment consumer fails. Repeat with one large ordinary text node, many predefined
entities and numeric references with long leading-zero spans; verify error precedence
and that recovery messages are not duplicated by replay. Text and CDATA bodies now
use 512-unit fragments. Repeat with large comments and processing-instruction
bodies inside and outside the root, including empty bodies and malformed delimiter
boundaries. These bodies now use the same bounded fragments. Whitespace-only PI
bodies preserve the buffered parser behavior (no trailing space before `?>`), which
differs from native xmllint. Repeat declaration validation and output with increasingly large whitespace spans
and malformed oversized fields. Stored declarations now retain compact normalized
fields; verify formatting, encoding and standalone behavior against native xmllint.
Names, attributes and namespace scopes still need separate backing work.

For recovery, repeat formatting, CDATA conversion and XPath with a missing final
closing tag. Verify repaired output and diagnostics, paged node writes and cleanup
on cancellation. Include `--recover --noout` to isolate the 64 KiB normalized-source
cache from document storage. Confirm source replay reads at most 4096 UTF-16 units
and retires its backing before output. Add deeply nested recovery input with short
names and a fixed namespace scope, small enough that source text alone fits the
cache; confirm linked parser frames spill and are restored in order. Interrupt a
frame write and a frame read during unwinding and verify descriptor cleanup. Repeat with ordinary parsing and confirm a node limit stops the producer before
its next chunk. Large individual tokens and namespace scopes still need separate measurements; do not qualify recovery as bounded end to end.

## Remaining qualification scope

Repeat with increasing *single-document* sizes, eval-all joins, YAML anchors/edits,
jq slurp, giant XML parser tokens and namespace scopes after the remaining
safe-fs-backed value/parser storage lands. Those values are still memory-resident; the multi-document JSON and
paged XML selection results cannot qualify them. A Node heap measurement cannot
replace workerd/Cloudflare results. Store raw
measurements temporarily in `/out`, summarize verified observations in the delivery
record and remove temporary evidence after use.

### XML file publication

Exercise `--output` with generated reused chunks, an external backing provider, and
a slow retained staging writer. Compare bytes and encodings with stdout/native
xmllint. Observe at most one 16 KiB write pending; replace a symlink before commit
and verify the guarded publication refuses it. Abort during acquisition, writes,
sealing, and publication; verify staging is retired after active I/O. Check hardlink
identity and unchanged destination content on limits and failed publication.
For providers without retained atomic staging, verify the 64 KiB page cache spills
and that replay begins only after serialization and shell output-budget admission.
This fallback retains the backend's ordinary write guarantees; it does not add
atomicity to a backend without it. Measure both paths with the Worker procedure
above; local deterministic spill tests alone are not Worker qualification.

### Deep XML serialization

Generate increasing nesting depths with formatting on/off and both canonical modes.
Measure parser and serializer phases separately: both parser ancestry and pending
serialization frames use injected backing with independent bounded caches. Verify frame
allocations reach external storage, indentation chunks stay bounded, namespace
rebindings match native xmllint, and backing failures/cancellation retire handles.
Include wide sibling sets to capture traversal spill volume and first-byte cost.

### xq conversion

Exercise repeated and distinct sibling names beyond the fixed index cache, deep
nesting, attributes, namespaces, CDATA, whitespace trimming, and multiple input
files. Compare the streamed mapping with the legacy conversion and run equivalent
filters through native jq. Use generated/reused chunks and slow sinks; verify XML
node and group storage reaches the injected external backend and is retired on
conversion failures, cancellation, and early query termination. Measure XML
conversion separately from jq: jq still retains arbitrary query values, and XML
parser tokens/namespace scopes still need bounded backing. Record Worker memory, CPU,
first-byte latency, and concurrent-request behavior using the procedure above.
