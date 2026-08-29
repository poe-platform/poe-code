# Fixed-window r8 binding v2 — helper HOLD, window resolved

ROOT explicitly replaced the withdrawn17:10/17:40 proposal with notBefore **2026-08-29T17:00:00.000Z**, external latest start **17:05:00.000Z**, existing `activeDeadline` **17:27:00.000Z**, and existing `deadline` **17:30:00.000Z**. This satisfies the unchanged schema. At latest start there are1500seconds total:1320active+180publication. No full1800-from-dispatch or guaranteed672-completion claim. Independent preexec `a54f318dedf6e80edd3ac12887f9e50ae4bff758` remains accepted; actual GO is absent.

The single permitted DATA helper exited/closed1 with captured199832-byte stderr and empty stdout. It verified packet,32 staged files and package before a newly added metadata-count assertion incorrectly compared `frozen.packageMembers` (an array) directly to1014. This is an author helper defect, not product/source failure. Source-only inspection confirms `selectedInputs.length=309`, `actualEmitted.length=1012`, and `packageMembers.length=1014`.

Original helper bytes and raw error are preserved. Current helper changes only that assertion to `.length`; it has not been re-executed. The absolute-path postcheck correction is retained. No grant, `BINDING.json` or success receipt was produced; publisher/tool/postchecks and fresh unused-slot checks were not reached. One additional explicitly permitted DATA replay is required. Do not run runtime or install a grant from this HOLD.

The32 runtime files,6945-byte packet SHA `6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9`, package1014 SHA `2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`, source309/emit1012, and publication-v2 are unchanged. Historical `9f3d9efa` path-postcheck failure remains separate and unrescored.

Future unchanged command, repo cwd/login:false:

```sh
/bin/zsh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r8/staged/new/launch.sh /private/tmp/B2-R8-ROOT-GO.json 6945
```

UTF8/no-newline command SHA `59b7adb628be811652ede031c8ea3a0726de316a5c6a9dc4663b4b3bf7b4b18f`. Future64knownOS/peak3,41children,34functional asynchronous-loader admissions,96MiBcapture/512MiBlogicalwork.128MiBcache reservation remains inside512MiB with best-effort nonatomic active sampling, no source upper-bound/quota/peak proof, and mandatory quiescent reconciliation. No runtime/npm/product/compiler/Worker/native execution occurred in this phase; no known child remains unresolved.
