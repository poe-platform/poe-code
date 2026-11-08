# Validation and limits

## Observed corrected capture

- Accepted source `21220b465537bf45ffcfb36740956a69f43bf75e`; Git archive SHA-256
  `209ec8394371d195ca0af3561eb5c6458e8949dadb96b79c5463741da7218e7a`.
- Node v22.22.2, TypeScript 5.9.3; Darwin arm64. The exact source/config inventory
  is in SOURCE_INPUTS.json and the complete archive src inventory is in the capture.
- Clean accepted archive build passed. This is a source build, not source/test/
  consumer typechecking, a public-package gate, or runtime locale implementation.
- 14 frozen category-selection controls and 517 admission-policy controls passed.
  They check a design model, not changes to product source. No global suites ran.
- Two separate runtime processes with harness ambient `en_US.UTF-8` and `C`
  produced identical results under the explicitly supplied command environments.
- In EACH process all original ten named invocations remained exact historical
  status/stdout/stderr refusals; these are retained mismatches, NOT ten passes.
- In EACH process nine separately labelled C.UTF-8 scalar counterfactuals matched
  the original expected output tuples. These demonstrate available scalar machinery,
  NOT nine passing en_US.UTF-8 invocations or an approved environment-alias solution.
- In EACH process nine accepted-source controls passed: implicit and explicit-empty
  virtual-default byte behavior, arithmetic/numeric relation with unknown explicit
  locale, C string comparison with unknown CTYPE, scalar literal, scalar backreference,
  escaped bracket literal, and unchanged backreference state-limit refusal.
- In EACH process the existing descriptor was accepted, an added locale field was
  rejected, and a named descriptor profile was rejected. No protocol was extended.
- Archive source files/config hashes and complete src file/directory inventory stayed
  unchanged before/after runtime. Owned scratch directories were removed in finally.

The initial invalid-ambient Node startup SIGSEGV and fixture correction are retained
in ATTEMPTS.md; no invalid-ambient runtime acceptance or defect fix is claimed.
CORRECTED-RUNTIME-CAPTURE.json records the explicit pre-manifest capture mode, not
a post-hoc claim that a manifest existed during initial capture.

## Frozen reproduction

From the repository root, explicit opt-in, no writes to committed captures:

```sh
node tests/commands/expr-stress/named-profile-design-20260827/verify.mjs
node tests/commands/expr-stress/named-profile-design-20260827/verify.mjs --runtime
```

Both commands authenticate the complete owned manifest before and after execution,
including new files/directories, original historical matrix bytes and immutable
accepted source inputs. Runtime additionally creates and removes its own isolated
archive/build directory. It uses installed minimal TypeScript development tooling;
its version is recorded, not inferred from a declaration-range string. It never
imports live src/dist, rewrites evidence, or runs native expr. `--initial-capture`
explicitly refuses to bypass an existing MANIFEST.json.

The global worktree may contain other owners' edits. This archive experiment neither
imports them nor certifies them. Source changes since the accepted commit need a new
candidate-specific acceptance; these historical-source controls are intentionally
outside canonical test discovery.

## Pending product work

No product file changed. Root must reconcile/assign internal.ts and the expr index.ts
matcher hunk before implementation, accept the broad bracket refusal boundary,
and then run actual named-environment tests against the newly committed candidate.
The nine scalar admissions are a design projection until that happens. String
collation, named classification, named ranges, literal bracket lists in restricted
profiles, newly invented locale aliases, nullable semantics, sequencing changes,
global parity and 72-hour completion remain outside this evidence claim.
