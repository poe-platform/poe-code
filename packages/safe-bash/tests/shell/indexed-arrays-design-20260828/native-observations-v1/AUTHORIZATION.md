# Received root authorization — August 28, 2026

The authorization is the current delegated user instruction, not a separately
signed document and not permission inferred from the earlier preseal. Its exact
manifest-specific GO text is preserved here:

> Different design review 0d70a9d4 at tests/shell/indexed-arrays-independent-20260828/{README,FINDINGS,NATIVE-PRESEAL-REVIEW}.md has EIGHT OPEN findings: NO product freeze/implementation. Root authorizes ONE bounded 16-row native OBSERVATION cohort EXACTLY presealed by abe53e03b654cd576dfa5f8f7a6cf435edc2b4d0, tests/shell/indexed-arrays-design-20260828/native-preseal-v1/MANIFEST.json SHA256 f731d304306b02d11df41b386d4528405ad307ca33098d25f1bc2a0193c0764f, reviewed by 0d70a9d4. Exactly 16 neutral questions, 1783 total script UTF8 bytes. GNU Bash binary /private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash SHA256 8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c; manual identity in original binding. Verify original commit/blobs/live sealed docs, binary/manual preflight. Fail CLOSED on drift, missing prerequisites, bounds, cleanup or integrity failure. NO fallback, NO retries, NO modified recipes. Do not call Bash --version/help/syntax or any additional native command. N01-N16 scripts are the only authorized native executions, once each sequentially. Nonzero status is observation, not failure or retry trigger.

> Root authorization text is this instruction: preserve receipt linking exact manifest/go, do not invent a separately signed authorization.

All other restrictions in that instruction remain binding. This receipt grants
no implementation approval, extra experiments, retries, broader process control,
XAN access, product imports, tests, or changes outside the assigned new trees.

The supervisor supports metadata-only `prepare`, then exactly one `observe` with
the committed seal revision. Both require absent exclusive output paths;
`ADMITTED.json` is durable and never reset. This is opt-in evidence tooling, not
canonical test discovery. Child scripts are data from the original sealed JSON.
Git subprocesses are metadata receipts only. Child launches use Node's direct
spawn with an absolute binary, a replaced environment and no shell wrapper.

Earlier metadata command note: a zsh loop inadvertently used its special `path`
variable, so cat/rg lookup failed. A corrected read-only metadata command used
`file`. This was a local command-construction error, not an authorization or
platform block; no native oracle was launched by either metadata command.
