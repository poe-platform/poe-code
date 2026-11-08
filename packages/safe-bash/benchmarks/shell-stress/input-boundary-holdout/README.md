# Frozen independent input-boundary holdout

This new leaf persists exactly the twelve already executed native GNU Bash 5.3
boundary/control probes from the final pre-fix independent verification. No
script is replaced or expanded. No source, author test, legacy expectation,
existing harness, package manifest, or dependency is changed.

## Immutable reference and pre-fix evidence

- Native binary: /tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash
- Binary SHA256: 8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c
- Native version: GNU bash, version 5.3.0(1)-release (aarch64-apple-darwin25.4.0)
- Reference artifact SHA256: aaa23f9b8e002ba7d2c0564e056512c813b26fff79d1843a533158a8f7c9e303
- Original capture report SHA256: 7c49e6f2d29dfed6799bb70069c710dae397940f9fc34fed58ca9b9879999e54
- Pre-fix source aggregate: 2565517b89a02e0d734870a752e5c1d8b4440ac5c036a35b502fa97415648eec
- Pre-fix revision: 677e03cd21e13e609a5f67d245b0b2f61d635024
- Pre-fix shell component: 19939a5a40ee48715019ba850a0cca8e8f05bb0d69dc064e0d144f898b41bf6c

references.json copies the original scripts, raw stdout/stderr text and base64,
statuses, complete file/directory snapshots, native identity, capture timing,
and safety limits. It is pinned by hash in the test. pre-fix.json records all
twelve original virtual observations, per-case unchanged-source proofs, the
complete pre-fix source-file hash map, and the original **11 pass / 1 fail**
result. These are preserved measurements, not a new pre-fix execution and not
post-fix acceptance. The native scripts were captured once each; no repeated
native capture is claimed.

All twelve scripts are bounded and safe to persist: they use fixed literal
scripts, no external network or host paths, only isolated temporary native files,
and the existing virtual child/process-group helper with deadlines and output
caps. The frozen tests do not require native Bash to be installed and create no
host files themselves. Fresh native revalidation, if requested, remains outside
the repository and must not rewrite these expectations.

## Comparison and failure policy

The suite reuses the existing targeted-holdout executable-identity comparison:
only line-leading shell-stress:, bash:, and shell: become <shell>:.
This is the same explicit basename-only treatment used by the original twelve
probes, not semantic diagnostic normalization. Raw evidence is unchanged. Source
line numbers, diagnostic wording and embedded payloads, stdout, statuses and
file bytes remain exact. The skipped-heredoc case has empty expected stderr,
so the regression has no normalization at all. No skips, TODOs, expected-failure
waivers, filters, or automatic recapture are introduced.

The pre-fix failure is skipped-heredoc-invalid-body-validation-timing:

~~~bash
printf before >before; false && cat <<EOF
$(true |)
EOF
printf after >after
~~~

GNU 5.3 exits 0 with empty streams and writes both files; pre-fix virtual exits
127 before either effect and reports an unrelated-looking efore token. The
other eleven controls cover same-line versus newline units, exit/fatal stopping,
compound and continued pipeline/and-or boundaries, quoted/escaped newlines,
queued heredoc bodies, shared stdin, and within-unit versus cross-unit locale
selection. Genuine old Bash 3.2 conflicts remain in the unchanged older suites.

## Validation status

At persistence time, the source author is fixing deferred-heredoc execution and
the root marker is NOT READY. This leaf has not executed post-fix tests. Run only
after the marker's first line explicitly declares READY and names the new fix
commit. Future results belong to distinct postfix artifacts, not this baseline.
This is not full-Bash compatibility or general superiority evidence.
