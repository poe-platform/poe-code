# Final qualification notes

S11 IO-first's actual operation snapshot is **not aborted**, reason null; its
public result is rejection0 and stage/caller reasons are0. Normal operation close
preceded caller abort in this observation. This does not resolve the prereplay
ambiguity or convert its strict BLOCKED status into a pass.

The empty `artifacts/sealing-transcript.txt` is a capture taken while the sealing
command was still writing. `artifacts/sealing-final-transcript.txt` preserves the
completed command output separately. Neither is an acceptance run. SEAL.json
remains unchanged; FINAL-SEAL.json binds the final evidence including these notes
and validation. All candidate/source/test/tool before/after identities match.

Two correction rounds were treated conservatively: initial location/provenance
binding plus canonical-path configuration correction. No third correction was
attempted for the now-known fixture issues. The complete historical facade claim
was premature and is explicitly retracted in REPORT.md; it does not invalidate
the independently reproduced213/15/708/358 candidate source/test/build identities.

The frozen supervisor collapses an inner record TIMEOUT to aggregate FAIL.
Raw S06 upload-first and S07 upload remain TIMEOUT observations, not passes;
no hard3000ms supervisor bound fired. Source-defect count0 means **none established
by this bounded evidence**, not that the source has no defects.

Root's private needs-root report names the unresolved bindings and fixture issues.
Any new fixture repair/replay requires a later bounded authorization; no live
source changes, old report edits, production permission or new API follows.

Acceptance subprocesses inherited environment without explicitly disabling tsx
cache (`TSX_DISABLE_CACHE` and `TSX_CACHE_DIR` unset; TMPDIR points at the ordinary
macOS temporary directory). Unlike historical replay's cache-disabled environment,
their loader cache footprint was not isolated to task TMP. No install or product
file mutation occurred, but **exclusive task-TMP loader writes are not certified**.
No ambient cache is searched, removed or altered to conceal this qualification.
This narrows REPORT.md's temporary-work statement to directly controlled fixtures.
