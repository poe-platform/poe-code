---
name: "Runtime jobs sync reports success after refusing a local file conflict"
---

# Runtime jobs sync reports success after refusing a local file conflict

## Summary

The `runtime jobs sync` command uses refuse-mode synchronization by default, but discards the returned download result and unconditionally prints a success message. When a remote file conflicts with a modified local file, the command reports success without informing the user that the remote update was refused.

## Reproduction

1. From the repository root, run this disposable Docker-runtime probe. It uses a fake Docker executable that returns a controlled remote archive:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-runtime-sync-conflict-probe.XXXXXX)
   mkdir -p "$probe/bin" "$probe/home/.poe-code/state/jobs" "$probe/project" "$probe/remote"
   printf 'LOCAL MODIFIED\n' > "$probe/project/conflict.txt"
   printf 'REMOTE CHANGE\n' > "$probe/remote/conflict.txt"
   printf 'REMOTE NEW\n' > "$probe/remote/new.txt"
   tar -cf "$probe/remote.tar" -C "$probe/remote" .
   cat > "$probe/home/.poe-code/state/jobs/job-sync.json" <<EOF
   {"id":"job-sync","env_id":"env-sync","env_kind":"docker","tool":"codex","argv":["run"],"cwd":"$probe/project","started_at":"2026-05-24T12:00:00.000Z","status":"exited"}
   EOF
   cat > "$probe/bin/docker" <<'EOF'
   #!/usr/bin/env node
   const fs = require('fs');
   const args = process.argv.slice(2);
   if (args[0] === '--version') { process.stdout.write('Docker version fake\n'); process.exit(0); }
   const cpIndex = args.indexOf('cp');
   if (cpIndex >= 0 && args[cpIndex + 1] === 'env-sync:/tmp/poe-workspace-download.tar') {
     fs.copyFileSync(process.env.REMOTE_ARCHIVE, args[cpIndex + 2]);
   }
   process.exit(0);
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"

   (
     cd "$probe/project"
     PATH="$probe/bin:$PATH" REMOTE_ARCHIVE="$probe/remote.tar" HOME="$probe/home" \
       "$workspace/node_modules/.bin/tsx" --import "$workspace/scripts/register-template-loader.mjs" \
       "$workspace/src/index.ts" runtime jobs sync job-sync
   )

   cat "$probe/project/conflict.txt"
   cat "$probe/project/new.txt"
   ```

## Observed Behavior

The CLI prints a success message while the conflicting remote update is refused and only the non-conflicting new file is pulled:

```text
◆  Synced runtime job job-sync.
LOCAL MODIFIED
REMOTE NEW
```

`src/cli/commands/runtime/jobs/shared.ts:86` through `src/cli/commands/runtime/jobs/shared.ts:99` await `env.downloadWorkspace()` but discard its `DownloadResult`, and `src/cli/commands/runtime/jobs/sync.ts:38` through `src/cli/commands/runtime/jobs/sync.ts:42` always log success afterward. `packages/runner-e2b/README.md:100` and the runner result shape expect refused local conflicts to be observable synchronization outcomes.

## Expected Behavior

When refuse-mode synchronization leaves remote updates unapplied because of local conflicts, `runtime jobs sync` should report those conflicts and return a non-success status or an explicit partial-sync result instead of unqualified success.

## Impact

Users can believe a detached runtime workspace was fully downloaded when local files silently retain older content. This can lead to missing generated changes, incorrect review decisions, and unsafe subsequent cleanup of the remote sandbox.
