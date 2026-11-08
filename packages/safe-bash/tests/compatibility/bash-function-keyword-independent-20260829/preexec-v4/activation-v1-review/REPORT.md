# B35 v4 final-slot review

**ACCEPT: final-slot SOURCE/DATA binding only. ROOT actual GO is still required.**

Binding source `5ea187ecceeacf25ee793d4b8fa80b96086ea0fc`, evidence `bfa687c244561785944a98e91d775ba1b10c29d7`. The scoped NUL Git inventory authenticates the current committed binding records; actual GO/REVIEW files are separately authenticated by exact size/hash and mode 0600.

- GO: 991 bytes, SHA256 `d483bbd28c5686e844b25bf56689538ad0a2720220d1cf1e18a8f065be9fef55`.
- Activation REVIEW: 204 bytes, SHA256 `34f4d2f65854f26968e3fe6a204432f060fef2c6628db51c2cce90a88b617d32`.
- Exact pending command: 340 bytes, SHA256 `477f1c1f142a40c906a4a7c666502e3fa07a23f9c2fd8910d12262c1f1900f8f`.
- Author PRESEAL: 9470 bytes, SHA256 `b4b562d5ce6673aea3f9d91c50b6697ebaf01f9b92ca8107265a84ff652edfa3`.
- Unchanged source `18e4c9a717809edd10230e3e5187111d9ed304b1`; package SHA256 `275a6c1006a5986d9d878a2344b95158fc320187a07a1d7f25584c10d7e7959d`.

The activation record has exactly decision/preseal/scope/independentCommit. Scope remains `b35-preexec-v3`; independentCommit is `556fc7efba79497fc64b8b8ce537b5d265dde266`. The rich receipt SHA256 `015f658695999a2ba0c10fb9c6875015a74605468a3a35e2a7631f5278e163ae` is authenticated separately and is NOT the command's review digest.

One sealed PURE data helper ran, importing only the authenticated unchanged activation validator. It checked the current instant with typed grant times, exact roles/limits and identity bindings. All 29 preseal members, three executable identities, the retained compressed package and 247 compiler/type inventory rows were freshly authenticated without executing them. No capsule/package inflation, build, install, product, readiness or Worker execution. The current source identity is the sealed candidate, not an assertion that mutable whole-repository HEAD equals it.

The owned future tree contains only empty directories at observation; its canonical root and empty capture directory were checked. The future measured-role slot remains explicitly PENDING_ACTUAL_OBSERVATION with null counts/retirement, not substituted planned numbers. This observation is not a lease: ROOT/launcher must recheck before dispatch.

UTC window: issued **August 29, 2026 14:00:06.737Z**, latest start **14:20:06.737Z**, expiry **14:45:06.737Z**. No extension. Actual final deadline is min(start+25min, expiry); there is no authorization to start after latest-start. RESULT.json and RECEIPT.json record the review's actual observation time.

Prospective actual bounds remain 65 runtime + 7 administrative = **72 known starts, peak 3; 25min inclusive; 96MiB capture, 512MiB logical work**. Case30s/build120s/finalization60s remain unchanged. Initial host/tool/zsh startup is trusted outside internal capture; logical accounting is not RSS or a global process census. Future actual measured roles remain unknown. All prior failures and the v3/v4 review qualifications are preserved; no suite rerun or historical rescoring.

Review grant: 5min inclusive, 18 known roles, peak3, 24MiB capture/96MiB work. Conservative task-local source/edit/check/publication inventory: 14 known roles, maximum two in the observed explicit parent-child routes; no global absence claim. The sole check process returned status0; raw stdout/stderr are retained.

Pending only, with repository cwd and login:false:

```text
exec /bin/zsh -f '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/preexec-v4/launch.sh' '9470' 'b4b562d5ce6673aea3f9d91c50b6697ebaf01f9b92ca8107265a84ff652edfa3' 'd483bbd28c5686e844b25bf56689538ad0a2720220d1cf1e18a8f065be9fef55' '34f4d2f65854f26968e3fe6a204432f060fef2c6628db51c2cce90a88b617d32'
```
