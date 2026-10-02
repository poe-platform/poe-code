# Extract unix2dos into a private command workspace

Baseline: remote main 42cd08acf0. Both command factories were owned by
safe-bash-command-dos2unix; conversion and publication already shared the private
safe-bash-line-ending-engine.

- Give unix2dos its own definition, direct-execution admission, single-command
  collection and collision-safe plugin. Preserve the existing two-command family.
- Move the shared asynchronous handler and synchronous evaluator into the existing
  line-ending engine. Preserve algorithms, limits, cancellation and staged writes.
- Move unix2dos safety regressions without weakening assertions. Characterize the
  missing package boundary before implementation.
- Admit the private workspace through manifests, lockfile and maintained build/unit
  graph. Keep canonical contracts and one portable bundled runtime owner.
- Verify workspace builds, unit/type/lint and package gates, existing line-ending
  behavior, isolated packed public imports, strict NodeNext declarations and
  Node/browser/workerd execution. Packed checks cover byte argv, error identity,
  scripts, pipes, cancellation, collision, limits and publication rollback.

No output/help changes, new default commands, external runtime dependencies or
standalone publication are intended. Public APIs include the existing family and
`commands/unix2dos`; documentation uses only public exports.

Verification completed:

- The new boundary test failed for the missing unix2dos entrypoint before extraction.
- Maintained command and Safe Bash build closures passed. Command/engine lint,
  source and test typechecks passed; the focused integration typecheck passed
  with ES2023, DOM and DOM.Iterable libraries required by imported adapters.
- 98 command/engine unit tests and 200 selected Safe Bash line-ending regression,
  safety, staged-publication and captured-snapshot cases passed without skips.
- 271 packaging/private-bundle/workspace-dependency checks passed. The packaging
  suite was rerun after rebasing concurrent alias coverage: 237 checks passed.
- The private-command package policy passed. The root portable-runtime lint rule
  requires a root build and was skipped; actual installed portable consumers were
  checked independently, rather than counting that skip as a pass.
- Public safe-fs, safe-js and safe-bash tarballs were installed outside the checkout
  without private workspace packages or workspace links. Public imports, Shell
  scripts/pipes, raw argv/error identity, cancellation, collision policy, explicit
  limits and staged-write rollback passed. Strict NodeNext declarations passed.
- Browser and workerd export-condition bundles from that isolated installation
  passed the same runtime fixture in a realm without host process, filesystem,
  network or global Buffer. Workerd WASM imports used compiled packed assets.
  This verifies those portable routes; it is not a deployment to Cloudflare.

The command's output/help and default inventory are unchanged, so no visual CLI
change requires screenshot validation. No standalone publication is introduced.
