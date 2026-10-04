# Bounded sort Worker qualification

Status: execution pending; this plan is not qualification evidence. Check modes
retain one preceding record; merge uses bounded fan-in, and general sort spills
runs through injected safe-fs. Oversized byte/key/numeric records use paged
storage. Exact host locale comparisons still materialize whole strings and are
not bounded. Do not qualify locale sorting until that limitation is resolved.
Node unit tests establish deterministic I/O and lifecycle behavior only.

## Setup

Record the tested commit, source hashes, workerd version, compatibility date,
Cloudflare deployment version, account limits, and filesystem adapter configuration.
Use an injected external safe-fs backend with retained positioned read/write
handles and conditional scratch removal. Record the provider's actual storage and
cache behavior. A private RAM filesystem, host temporary directory, or whole-file
adapter fallback is not an external spill backend.

Generate input in reusable bounded chunks. Disable shell result capture and send
stdout to an awaited, deliberately slow streaming sink. Measure the backend and
sort separately: count live owned buffers, peak outstanding read/write bytes,
storage bytes written/read, open descriptors, and remaining scratch entries.
Instrument `readFile` and full-payload concatenation to fail on the streaming path.

## Execute manually

1. Run ordered input through `sort -c` and `sort -C` at 1, 8, 64 and 256 MiB,
   then larger inputs permitted by the deployment. Keep ordinary record width
   fixed. Repeat with disorder at the beginning, middle and end, `-u`, NUL
   delimiters, unterminated records, and a producer that reuses its backing bytes.
2. Merge already sorted sources using `-m`, increasing both total bytes and
   source count. Record first-output latency and bytes read from each input before
   first output. Exercise stable ties, reverse keys and duplicate elimination.
3. Sort reversed and shuffled data larger than the memory budget. Vary memory
   budget independently of input length. Verify that external spill traffic grows
   while owned RAM remains within the declared bound. Repeat with an individual
   record substantially larger than the memory budget, including equal long
   prefixes and very long numeric fields.
4. Verify raw output digests and file effects against the supported native oracle
   and explicit locale contract. Cover lexical, numeric, human numeric, general
   numeric, month and version modes, key endpoints, invalid UTF-8, stable ordering,
   and `-u`. Test `-o` against the input path and aliases with retained identities.
5. Inject cancellation, read/write failures, short positioned reads/writes and a
   slow or rejecting sink during ingestion, spilling, merging and publication.
   Verify original error/cancellation behavior, input finalization, descriptor
   retirement, scratch cleanup and the specified destination publication policy.
6. Repeat the size series with 1, 2, 4 and 8 concurrent requests. Record actual
   Worker memory observations, CPU time, wall time and first-byte latency for
   every request. Use workerd profiling and deployed Cloudflare observability,
   identifying exactly which memory metric each environment exposes. If a metric
   is unavailable, mark it unmeasured; Node heap statistics are not a substitute.

## Evidence and decision

For each run record input size, largest record, source count, locale, flags,
configured memory budget, output digest, first-byte latency, CPU, wall time,
memory metric and peak, peak outstanding bytes, spill traffic and cleanup result.
Retain failure cases alongside successful runs. Repeat trials and disclose other
workload on the host/account. Increasing input size must not increase the declared
working set at fixed budget; provider-retained RAM must be accounted separately
and must not hide a payload-sized in-memory spool.

Store temporary output under `/out` and purge it after recording the reviewed
evidence. Do not declare Worker qualification until the measurements, exact byte
results, injected-provider behavior and all failure-path checks have passed.
