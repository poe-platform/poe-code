# Evidence verification and bounded reconstruction

After the final evidence commit, run from the repository:

```sh
node tests/shell/getopts-independent-20260827/stage2/safejs-getopts-followup-618d8967/verify-v2.mjs FINAL_EVIDENCE_COMMIT
```

Omit the final argument for working-tree seal verification. This checks both
executable freezes, exact older accepted tree membership with the single new
sibling exclusion, current evidence membership including additions, raw capture
hashes and authenticated removed-scratch manifests. It runs no product/native
oracle/private engine and does not rewrite evidence. No canonical test discovery
was added. The original verify.mjs/finish.mjs are preserved v1 inputs; use v2.

The one-shot chronology actually executed was:

1. Inspect existing guest API/loader/guards and accepted reports. prepare.mjs
   authenticates the sealed archive/package, copies exact private/public tools,
   installs the tarball offline with scripts disabled and writes FREEZE.json.
   Preparation failure logs/corrections are retained. No product executes here.
2. Commit5b3c6c08ecb21a05db47fb4c191f693d32e1dc78, then invoke pinned Node24
   `run.mjs 5b3c6c08ecb21a05db47fb4c191f693d32e1dc78` once. This stops after G1.
3. prepare-v2.mjs checks the original frozen copies and creates only the explicit
   run-v2 regular-copy append. It authenticates the exact two-line host setup
   correction and writes FREEZE-v2.json. Original guest programs stay unchanged.
4. Commit09a08165f2576b1cf6eb61577cec235688e5ae92, then invoke pinned Node24
   `run-v2.mjs 09a08165f2576b1cf6eb61577cec235688e5ae92` once. It runs G1 and G2.
5. Write the qualified assessment/report; run
   `finish-v2.mjs 09a08165f2576b1cf6eb61577cec235688e5ae92`, then verify-v2.mjs.

These are deliberately no-overwrite capture drivers, not commands to rerun over
the sealed directory after cleanup. Their executable bytes, expected observations,
exact process argv/environment, import maps and all results are preserved. Fresh
execution requires a new explicitly authorized owned capture/root binding and
freeze, not deletion or modification of existing freezes/evidence. No such extra
execution is authorized or performed by this followup.

For reconstruction under that new authorization, use the sealed candidate.tar.gz
and public-package.tgz in ../review-618d8967/evidence-v1 (SHA256s in FREEZE.json),
not live product source. Full source/package/compiler/node inventories are bound
by the earlier accepted raw PUBLIC-BINDING and this capture's import/scratch
manifests. The installed package was physically moved; v2 is a regular copy of
that exact full installation. The private engine is intentionally absent: the
exact264-record approved private profile and pinned public TypeScript/Node tools
must be available, with unchanged guard checks, or execution is blocked. Reuse
original loader/private/capability guard bytes and the exact child-v2.mjs plus
unchanged G1/G2 guests. Rebase only explicit owned root paths in the frozen import
map; never broaden the import closure or create a fallback. The process records
give the precise loader order, limits, environment and child entrypoint.

Decode evidence-final/RAW.json.gz.base64 as Base64 then gunzip and parse `files`.
Check compressed/raw hashes against RAW-MANIFEST.json, then each file length/hash.
Entries include v1/v2 logs, source guest hashes, actual returned observations,
in-guest completion/rejection evidence, builtin entries, authenticated import
records and hash-only private preparation snapshots. Extract only to a new owned
directory, rejecting duplicate/absolute/traversal paths. No engine source is
embedded. SCRATCH.json.gz.base64 similarly preserves the exact removal inventory.
The separate preparation-attempt-02 closure preserves its earlier partial cleanup.

Do not relabel G2 as passing merely because its first script state lines match.
Its guest assertion rejects on unsupported export -p, and no second bridge exec
occurs. No silent correction/replay is part of reproducing this evidence.
