# E2B workspace upload includes gitignored and Poe-Code-ignored files

## Summary

The shared workspace-transfer implementation and runtime design specify that uploads apply `.gitignore` and additive `.poe-code-ignore` exclusions. The E2B execution environment instead creates a raw `tar` archive using only configured `runner.workspace.exclude` patterns, so files ignored by either project ignore file are still uploaded into the sandbox.

## Reproduction

1. From the repository root, run this disposable probe with a mock E2B sandbox that saves the uploaded archive locally:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-ignore-upload-probe.XXXXXX)
   mkdir -p "$probe/local"
   printf 'secret.env\n' > "$probe/local/.gitignore"
   printf 'ignored-by-poe.txt\n' > "$probe/local/.poe-code-ignore"
   printf 'SECRET E2B\n' > "$probe/local/secret.env"
   printf 'PRIVATE E2B\n' > "$probe/local/ignored-by-poe.txt"
   cat > "$probe/repro.mts" <<EOF
   import { writeFile } from "node:fs/promises";
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   const sandbox = {
     sandboxId: "sb_probe",
     commands: { run: async () => ({ exitCode: 0 }), list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => {} },
     files: { read: async () => new Uint8Array(), write: async (_path: string, data: ArrayBuffer) => { await writeFile("${probe}/uploaded.tar", Buffer.from(data)); } },
     pty: { create: async () => ({ pid: 1, wait: async () => ({ exitCode: 0 }), kill: () => {} }) },
     setTimeout: async () => {}, kill: async () => {}
   };
   const env = createOpenedE2bEnv({
     sandbox: sandbox as any,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "${probe}/local", runtime: { type: "e2b" }, runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [".git", "node_modules", "dist"], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   await env.uploadWorkspace();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   tar -tf "$probe/uploaded.tar"
   ```

## Observed Behavior

The uploaded E2B archive contains both files that project ignore rules designate for exclusion:

```text
./ignored-by-poe.txt
./secret.env
```

`packages/agent-harness-tools/src/workspace-transfer.ts:82` through `packages/agent-harness-tools/src/workspace-transfer.ts:112` implement `.gitignore` and `.poe-code-ignore` filtering, and `docs/plans/archive/e2b-integration.md:903` through `docs/plans/archive/e2b-integration.md:910` specify that remote uploads use it. However, `packages/runner-e2b/src/opened-env.ts:74` through `packages/runner-e2b/src/opened-env.ts:102` invoke `tar` with only `input.spec.uploadIgnoreFiles` exclusions and never read either ignore file.

## Expected Behavior

E2B workspace uploads should omit files matched by `.gitignore` and additive `.poe-code-ignore` rules before transferring workspace data into the sandbox.

## Impact

Project files intentionally excluded from transfer, including gitignored secrets or local-only artifacts, can be uploaded into remote E2B sandboxes unexpectedly.
