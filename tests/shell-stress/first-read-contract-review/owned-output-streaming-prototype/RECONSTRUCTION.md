# Reproduce the sealed TEMP source

Working directory is `/Users/kjopek/Workspace/safe-bash`. Only existing Node,
TypeScript/tsx and the existing apply_patch command are required. Do not install
dependencies or build/typecheck the main checkout. Never alter prior candidates.

1. Materialize `restore.mjs.data` as a fresh file named
   `/tmp/safe-bash-owned-output-streaming-prototype-restore-tool-<unique>.mjs`
   using apply_patch. Keep the repository archive inert; do not rename it to .mjs.
2. Run `node /tmp/safe-bash-owned-output-streaming-prototype-restore-tool-<unique>.mjs`
   from the repository root with the existing author PATH containing apply_patch.
3. The script creates a unique task-owned TMP candidate. It verifies all restore
   inputs, authenticated v1, the frozen four-file retention delta, S1 source/API,
   source/test/config hashes, compiled files and all 358 actual compiler inputs.
   It uses only the old inert archive plus recorded patches/fixtures, never current
   live source as fallback. It reaps each synchronous tool child and seals its
   reconstructed candidate read-only before emitting reconstruction-proof.json.
4. Use the proof's compiled import/declaration paths. Do not run build scripts or
   mutate a sealed candidate. Independent execution is permitted only after root
   observes actual author CLOSED, not merely the ready marker.

Already tested immutable review locations:

- Author import: `/tmp/safe-bash-owned-output-streaming-prototype-work-C7rt0j/candidate/dist/index.js`
- Operation import: `/tmp/safe-bash-owned-output-streaming-prototype-work-C7rt0j/candidate/dist/contracts/output.js`
- Declarations: `/tmp/safe-bash-owned-output-streaming-prototype-work-C7rt0j/candidate/dist/contracts/output.d.ts`
- Reconstructed import: `/tmp/safe-bash-owned-output-streaming-prototype-restore-BTiVwM/candidate/dist/index.js`

For a bounded author-only replay, from the reconstructed candidate run:

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/shell/owned-output-streaming-author.test.ts
```

The archived supervisor can bound this known child group; its outputs belong
outside the sealed candidate. The existing frozen tests include their own finite
deadlines and loopback cleanup. The author already reproduced compilation/type
inputs; further source changes invalidate the seal rather than creating a new
passing interpretation. `runs/reconstruction-S1.json` is the raw successful
reconstruction; `reconstruction-proof.json` contains exact reaped child identities.
Source/test/tool manifests are in tested-manifest.json. The old original and
adapted probes have zero content delta; binding-path-delta.json records relocation.
