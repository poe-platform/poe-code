# Worker v3 different source/DATA review preseal — 2026-08-28

Frozen subject `f9bf774409eca40b0518b322db6fcb652cd6cd7f`; author DATA
evidence `10f49933f430dccfd828dce1c5339ab8b2851458`. No newer public-closure,
L02/L08 or scaffold corrections enter this review. Prior v2 review stays intact.

Design seal SHA-256:
`7a89d5911ddadcd7154c84553ce35442e744f2ded14d484af2b4e1bc92fcdacd`.
Preparation seal SHA-256:
`12f754bcb5cbd68bc4fbd7e187a2d529a20769d61b355fd74c3693f50c7d38a9`.

Finite source/DATA questions: R1 optional own-undefined typed-FsError handling;
R2 metadata-only FINAL_ACK; R3 exact READY/doorbell/cache/postcopy schemas;
R4 nonacquisition versus uncertain Worker ownership. Independently inspect the
concrete sync-bridge/wire/parent-RPC/scaffold/owner/reservation flow for full-payload
admission, byte/frame/sequence bounds, cutoff, parent error provenance, guest
identity/descriptor validation, ownership registration/release and K1–K3 gaps.
K2 postcopy evidence must not be inferred from transport ACK. D1–D3 remain fixed.

DATA recipe: one standalone checker using Node builtins only; at most three
read-only Git children (one NUL inventory and two cat-file batches), peak two
including checker. No subject/harness imports, syntax compilation, model/Worker/
engine execution, private filesystem reads, native Node subject, public-entry
probe, network or public-source fetch. Read the exact two subject subtrees and
the48 already-declared pinned input records; verify body hashes, inventory,
seal bindings and source-text/data relationships. Do not materialize executable
engine sources. The inherited public66 archive can be decoded as bounded DATA
only if needed; no new public transitive closure is requested here.

Ceilings:10min,12 harmless metadata children, peak2,32MiB capture,128MiB logical
work/retained data. Individual Git child30s, maxBuffer16MiB, decoded DATA8MiB.
The planned four processes (checker plus three Git children) are a subset of
these ceilings. Source-reading/development Git commands outside the checker
remain read-only metadata/authoring, never subject execution. Any checker failure
is retained and dependent checks stop; no silent correction/rescore. Write only
this owned versioned review directory with exclusive output creation. No source
changes in apply_patch or Locke's design/preparation scope.

Evidence will distinguish (a) byte/inventory checks, (b) manual source reasoning,
(c) missing actual lifecycle/heap/Shell/engine observations. All8 WRQ mappings,
11 proposed Worker/10 guest ceilings and nine source branches remain proposals;
no source/DATA predicate is a semantic or OS pass. Concrete findings go to ROOT
before any proposed actual experiment. No launch authorization is implied.
