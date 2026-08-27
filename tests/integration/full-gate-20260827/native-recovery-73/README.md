# Exact rg recovery — author evidence for independent review

2026-08-27. Source `1ebc9d71`. No policy hash was rebaselined, package installed,
system binary replaced, native semantics rescored or gate launched.

The installed Codex native package identifies itself as `0.150.1-darwin-arm64`.
Its rg has SHA256 `5d24e1af7efa7811e03df5555eeaa984bc8bd98ab42a5d49ecf30f163273e6c7`.
The accepted hash remains `4298efd414836892c913b2e87401d62fdd7c6ec4026d9bad8e3fab10557e411f`.
Both binaries print ripgrep15.2.0/e89fff89ac, NEON and PCRE2 10.45. Equal version
strings do not authenticate equal binaries. This investigation does not establish
why the executable changed; installed package metadata is not a build attestation.

Two retained regular files match accepted bytes exactly:
- `/tmp/safe-bash-search-sidecar-review-tnXxyl/native-bin/rg`
- `/tmp/safe-bash-search-stdin-close-fix-20260827/native-bin/rg`

The latter review's committed `qualification.json` records that identity and
version. `RECOVERY.json` binds its hash, both retained copies, installed metadata,
the unchanged historical policy, recovered file and actual asset assessment.

Recovered owned copy:
`/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-bash-rg-recovered-gsSpuz/rg`.
Use its explicit `RG_NATIVE_BIN` only in a separately versioned successor native
requirement with the **same accepted SHA256**, `originEnv: RG_NATIVE_BIN` and
`target: native:rg`. Historical8670 policy stays unchanged. Assessment of that
proposed origin selection plus the same other48 assets is **49/49**. It is not
next-candidate admission; expr/du prerequisites remain separately inventoried.

Seven author controls pass: exact copy; missing, corrupt and changed-same-version
source rejection; source symlink rejection; existing/symlink destination refusal.
Existing bytes and both accepted originals remain untouched. The recovered copy
is deliberately retained for coordination; control temporary directories removed.
Independent review is still required. Commands:

```
node --test --test-reporter=tap tests/integration/full-gate-20260827/native-recovery-73/controls.test.mjs
node tests/integration/full-gate-20260827/native-recovery-73/recover.mjs /tmp/safe-bash-search-sidecar-review-tnXxyl/native-bin/rg
```
