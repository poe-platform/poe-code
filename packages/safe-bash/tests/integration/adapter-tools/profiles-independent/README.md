# Independent canonical rmdir reconciliation review

This is a different verifier's work, restricted to this new subtree. Production,
root configuration, original tests/helpers, author evidence, contracts, manifests,
exports and historical evidence were read-only. See `REPORT.md` for the bounded
decision, `ATTEMPTS.md` for retained verifier setup mistakes, and
`AUDIT_DISCOVERY.md` for provenance-audit applicability.

The immutable target is `3bf672f722da2bdf1591ed112290b702987bf63a`, not live HEAD.
The package remains `virtual-bash`. Tests use actual aggregate `agentCommands`.

Using the already installed development tools, without installs or downloads:

```sh
node tests/integration/adapter-tools/profiles-independent/verify.mjs new-runtime-label
node tests/integration/adapter-tools/profiles-independent/audit.mjs new-audit-label
node --test tests/integration/adapter-tools/profiles-independent/provenance.test.mjs
```

Labels must be new. The first runner archives committed inputs, builds strictly,
runs SOURCE canonical81, packs offline, strictly compiles a differently named
consumer, runs packed canonical81 and the unchanged 22/27 controls, then runs 14
new controls, three bounded emitted-helper/selector mutations and restoration.
It never registers the historical whole matrix again.

The audit runner authenticates existing historical seals and reuses the retained
authenticated WsgiDAV evidence. It does not start a provider or download wheels.
It executes the old evidence auditors only in owned copies. For the one-shot
audit, it first retains its normal no-overwrite failure, then removes only the
copy's seal to reach its stale live-original assertion. The original seal is
never removed or updated. The shared Git directory is used read-only, with an
explicit isolated work tree and optional index writes disabled.

`provenance.test.mjs` verifies the retained qualified runtime and third audit
attempt, including entire packed/build equality, source/helper/config/history
bindings, load hashes and cleanup. Its checks are not a product-wide release
gate. `controls.test.ts` is canonical TypeScript, included in both scoped strict
typechecks; no `.mts` consumer source is introduced.

All `evidence/**` JSON/log/`.txt` and tarballs are captured evidence or explicitly
classified historical input data, not canonical TypeScript. Archived service
inputs can contain old `.mts` files inside tarballs; temporary extraction is
removed. Generated consumer source, emitted JavaScript, temporary HOME/npm cache,
real-adapter directories and loopback fixtures remain inside owned isolation and
are removed. No global configuration, dependency tree or user native artifact is
cleaned or modified.
