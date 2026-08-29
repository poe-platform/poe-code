# SOURCE/DATA read preseal

Review source e013f817fd7700c59a144c395c80dc25856e4157 and evidence
3b1a412af3bfa7c38a8f2796e815c4fdb26bfe27. Fixed accepted CORE293 catalog,
engine72187e5 and transport02782056; never substitute live HEAD or transport46611.
Read at most48 explicit stored blobs, each at most1MiB, aggregate at most4MiB.
Git batch metadata precedes payload decode; exact framing/type/size/Git SHA1 and
SHA256 are checked before text/JSON interpretation. No product imports.

At most two Node helper processes: syntax-only admission qualification and the
source/table admission helper. Its two Git metadata/blob children are counted
separately inside the40-known-process SOURCE grant. Remaining work uses bounded
source displays, four explicit Git source diffs and documentation publication.
No compiler, parser/engine execution, Worker, native, network or private input.
All helper output captures are established before launch. Original input copies
and raw payloads remain immutable after admission. Runtime mapping is70 UNRUN
IDs, not executed cases or runtime acceptance.
