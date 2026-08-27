# Verify or reconstruct the sole fixture correction

After the final commit, from this repository:

```sh
node tests/shell/getopts-independent-20260827/stage2/safejs-getopts-g2-correction-618d8967/verify.mjs FINAL_EVIDENCE_COMMIT
```

The optional commit argument checks every final artifact against Git. Verification
authenticates both older complete seals and unknown additions with only this
explicit sibling excluded, then the separate current freeze/evidence membership.
It performs no product/native/private execution and rewrites nothing.

Actual one-shot sequence: prepare.mjs (no engine execution), commit
1cf6596a76c4dbeca77af8e3d71f93c4c12c5137, then pinned Node24
`run.mjs 1cf6596a76c4dbeca77af8e3d71f93c4c12c5137` exactly once. The driver selects
ONLY G2, with no-overwrite evidence admission and no retry. After settlement,
finish.mjs with that freeze commit captures logs and authenticated scratch, removes
only enumerated scratch and seals the current append. Original fixtures/records
in the previous siblings remain untouched.

The executable drivers, exact corrected guest, two-line diff, old/new guest and
bridge-script hashes, full process argv/environment and import bindings are
preserved. These capture scripts deliberately refuse overwriting the sealed run.
Any future execution requires new explicit authorization and a new owned capture
binding/freeze; this continuation authorizes no further child.

Dependency reconstruction uses the existing accepted review's candidate.tar.gz
and public-package.tgz, not live product. FREEZE.json binds their hashes plus the
original helpers/loader/guards, installed package/compiler/Node and264 eligible
engine-record profile. Prior scratch was absent, so regular engine copies were
recreated using the unchanged private guard/copy operation. Private bytes are not
committed; unavailable or changed approved private state must block execution.
No new runtime, guest capability, native fallback or relaxed allowlist is used.

Decode evidence-v1/RAW.json.gz.base64 as Base64, gunzip, verify RAW-MANIFEST.json,
then verify every entry's byte length/SHA256. Captures retain actual guest results,
both script outputs, builtin bridge correlation, imports, preparation snapshots
and install output. Extract only to a new owned directory with traversal/duplicate
rejection. SCRATCH.json.gz.base64 similarly binds every removed owned entry.
No private engine source is included. Historical1/2 evidence is not rewritten or
retroactively rescored by this single correction.
