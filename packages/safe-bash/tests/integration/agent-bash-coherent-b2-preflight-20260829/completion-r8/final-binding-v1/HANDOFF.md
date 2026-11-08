# r8 final binding — HOLD, not ready for activation

The newly accepted independent preexec `a54f318dedf6e80edd3ac12887f9e50ae4bff758` is recorded. No preexec acceptance was invented before ROOT supplied it. Runtime packet remains 6945 bytes / SHA256 `6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9`, with all 32 runtime files unchanged. No actual grant was installed at `/private/tmp/B2-R8-ROOT-GO.json`; no runtime/npm/product/compiler/Worker execution occurred.

## Exact policy conflict

Existing `support.mjs` requires `deadline - notBefore == 1800 seconds`, with `activeDeadline == deadline - 180 seconds`. It computes elapsed time from that fixed anchor, not dispatch. Therefore requested expiry **17:40 UTC** requires **notBefore 17:10**, active deadline **17:37**. Requested external latest start **17:10** leaves a zero-width launch interval, not a practical window with full 1800 seconds from an arbitrary start.

ROOT must choose either an earlier anchor and correspondingly earlier expiry, or a later external latest start with explicitly shrinking remaining time. No schema/code change, new unsupported grant field, rolling deadline or false full-duration claim is made here.

The pending-only draft is 1081 bytes, mode0600, SHA256 `82cf566716bdd9baa8eb094a8a3afe790ecdd5376ccdb7254e6c311a3b6f0eca`. It records issued16:44:04.544/notBefore17:10/active17:37/expiry17:40 on August29,2026. Existing authority strings are prospective template fields, NOT actual authorization. Only the scoped `GRANT.pending.json` exists.

## Captured helper failure, no retry

The sole DATA helper first authenticated packet, 32 staged files, package, publication-v2, Node and two tool entrypoints (38 pins), and checked all three runtime/capture/grant slots absent. It then wrote the pending draft. During postchecks its own `{path: absolute, ...expected}` construction overwrote the absolute path with a relative manifest path. The first relative recheck failed `ENOENT lstat legacy/harness/ARRAY-CASES.json`. This is an ordinary helper defect, not missing product/source data or a runtime finding. Exit/close1 and complete stderr are retained; no unresolved known child. Completed before-checks are not upgraded to completed postguards.

The original helper is preserved as `evidence/bind-attempt-1.mjs.data`. Current helper has the one-line source-only correction `{...expected, path: absolute}`; it was NOT rerun because the one-helper allowance was exhausted. No `BINDING.json` success record exists. Fresh bounded DATA replay after ROOT's window decision is required before final-slot review.

## Future command and unchanged qualifications

```sh
/bin/zsh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r8/staged/new/launch.sh /private/tmp/B2-R8-ROOT-GO.json 6945
```

Repository cwd, `login:false`; do not execute from this HOLD. Future64knownOS/peak3 = owner+41sequentialchildren+22administrative reservations; 34 functional asynchronous-loader admissions, no guest/Regex. 96MiB capture,512MiB logical work. The 128MiB cache reservation is included, with ROOT-approved best-effort nonatomic native-tool sampling, no source upper-bound or OS quota, and mandatory quiescent reconciliation. Source309/StageA1012/package1014 SHA2fe remain unchanged. Original224PASS/448UNRUN/type8diag, FSYNC/timer/publication STOPs remain unrescored.
