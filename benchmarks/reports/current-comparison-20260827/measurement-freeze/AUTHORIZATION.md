# ROOT-authorized committed comparison freeze

ROOT authorizes candidate `e33974b8c643077453227a9679d8ceca8367998c`, Git tree
`f559246f1317af7691de00333e13dfc8f44ef428`, for committed frozen comparison only.
All six required ancestor checks passed before preparation. This leaf stops at
static PREFLIGHT and an independent-freeze-check handoff. It must not import
product engines or run MEASURE. ROOT will announce the exact full candidate,
source/package hashes and receipt hash before product imports and delegate
execution without requesting another user authorization.

The immutable binding and proposed ROOT receipt interpret the existing
`qualificationAccepted: true` field **only as this comparison authorization**.
It does not assert release qualification, global/whole-gate success, complete
env-S support, shebang support, resolved independent fixture validity or an
already completed independent review of this new freeze. ROOT whole-gate cleanup
is not a prerequisite. These explicit instructions supersede the older generic
qualification wording in the unchanged bridge's BINDING.md.

Only `measurement-freeze/**` and isolated `/tmp` are writable. Source, scripts,
cohorts and runner are read from the exact Git revision, not the moving worktree.
Product/root/other reports/private work remain read-only. In particular, no edit
or execution of `tests/commands/file/text-bound.test.ts` is permitted here.

Allowed preparation: one current source-artifact authentication/copy pass,
verified locked existing dev dependencies, compiler-only build, deterministic
offline public-package archive/extraction/move, actual moved-byte verification,
and the reviewed bridge's bounded static PREFLIGHT. Required static binding
reads of moved copies are not a new historical comparison or repeated old audit.
No installs, downloads, fresh native oracles, full tests/typechecks, product
imports, measurements, timing trials, staging or commits are authorized here.

Profiles are exactly original, aligned and breadth. Original/aligned captured
goldens remain separate. Breadth retains declared intent, not native parity.
New holdouts are not measured. Pinned just-bash 3.4.2 authentication is limited to
its published package; other closure/tool bytes are lock/hash-bound, not each
publisher's independently authenticated supply chain. No latest-release claim.
