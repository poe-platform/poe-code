# Codex read-only sandbox QA (issue 139)

Verify on a Linux host that rejects bubblewrap loopback initialization, using a
Codex installation supporting `use_legacy_landlock` and a kernel supporting
Landlock. Run from the existing Poe Code checkout. These checks do not call an
LLM or change persistent Codex settings.

## Reproduce and verify reads

1. Run `codex -c 'sandbox_mode="read-only"' sandbox /bin/pwd`.
   On the affected host, expect exit 1 with
   `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` before `pwd`
   runs. This is a host/Codex sandbox startup failure, not a safe-bash failure.
2. Run `codex --enable use_legacy_landlock -c 'sandbox_mode="read-only"' sandbox /bin/pwd`.
   Expect exit 0 and the checkout path.
3. Run `codex --enable use_legacy_landlock -c 'sandbox_mode="read-only"' sandbox cat packages/agent-spawn/src/configs/codex.ts`.
   Expect exit 0 and the configuration file contents, without approval for the
   command inside the sandbox.

## Verify isolation

1. Choose an unused path under `/tmp`, then run:

   ```sh
   codex --enable use_legacy_landlock -c 'sandbox_mode="read-only"' sandbox python3 -c 'from pathlib import Path; Path("/tmp/poe-issue139-denied").write_text("must be denied")'
   ```

   Expect `PermissionError` and a nonzero exit. Confirm the path does not exist.
   If writing unexpectedly succeeds, remove only this newly created QA file and
   treat the check as failed.

2. Run:

   ```sh
   codex --enable use_legacy_landlock -c 'sandbox_mode="read-only"' sandbox python3 -c 'import socket; socket.socket(socket.AF_INET, socket.SOCK_STREAM)'
   ```

   Expect `PermissionError` and a nonzero exit before any connection is made.

## Verify Poe Code launch behavior

Run the maintained agent-spawn test route:

```sh
npm run test --workspace=@poe-code/agent-spawn
```

The read-mode cases cover normal and resumed noninteractive launches, plus
interactive launches. Each must retain `read-only` and enable
`use_legacy_landlock`, without selecting full access or bypassing the sandbox.

For a standalone Codex session on the affected host, start a new session with
`codex --enable use_legacy_landlock -s read-only`. Poe Code supplies these flags
when callers select `mode: "read"`. Existing sessions retain their startup
configuration. This compatibility path is for read-only policies; policies
requiring isolation unavailable in Landlock must fail closed and require a
compatible host. Do not remove namespace isolation or enable full access to make
this check pass.

## Delivery verification

Confirm remote `main` and the published release tag both contain
`0045f2af14e61146c7c4b39bbcda1187cdb1d39b`, the read-mode implementation. Monitor
any new push through the GitHub Release workflow, and confirm publication rather
than treating a local commit or a push as release success.

## Verified result

On 2026-09-20 with Codex CLI 0.155.1 on the affected Linux host, the default
backend failed with the reported loopback error. The Landlock backend printed
the checkout path and configuration contents; filesystem writes and network
socket creation were denied. The implementation was already present on remote
`main` and in published release `v17.0.25` before this QA document was added.

## Repeated occurrence (issue 140)

Issue 140 reports the same startup failure as issue 139. On 2026-09-20, a second
Codex CLI 0.155.1 session in this checkout reproduced it before even a skill-file
read could run. The read-only compatibility probe again read the configuration
successfully, denied a filesystem write, and denied network socket creation.
The normal and resumed spawn regression tests and interactive launch tests cover
the compatibility flags already supplied by Poe Code.

The second session used workspace-write permissions. A direct workspace-write
probe also failed with the loopback error; enabling `use_legacy_landlock` for that
policy failed with `permission profiles requiring direct runtime enforcement are
incompatible with --use-legacy-landlock`. Keep that refusal: the read-only
compatibility flag cannot safely repair this workspace-write policy or change
an existing session. New read-only launches use the existing fix; workspace-write
requires a host capable of enforcing its sandbox policy.

Deliver the recovery diagnostic in `59baca37f5ae69f027158a379de02c7512d15342`
alongside the read-mode fix. It exposes the original failure and the supported
read-only recovery in CLI and SDK streams, including when Codex sends no matching
tool-start event. Verify both commits on remote main and in a published release.
