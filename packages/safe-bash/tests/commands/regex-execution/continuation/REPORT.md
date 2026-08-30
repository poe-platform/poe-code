# Regex production continuation author checkpoint

August 27, 2026. **Source handoff, NOT default/production acceptance.** F1 still
needs a separately owned lifecycle contract. No new contract, runtime/shell/FS,
root export/registry, dependency or opt-in change. No subagents. All six additional
pathological probes remain UNUSED; author allocation zero throughout.

Independent baseline `471f4ca` was read before product edits. Author failing
expectations/benign controls were committed first at `858f387`: host containment
failed, normal output/cleanup passed, and both grep/rg early-EOF commands failed
the zero-live-worker assertions at exec settlement and after Shell.dispose.

## In-scope correction

- Original `search/glob.ts` native constructor/test callpath through Walker's CLI
  validation, ignore load and filename selection now runs in static worker
  `regex-execution/matching.ts`. The glob compiler is retained, not replaced with
  another dialect. `Glob` is now an internal async adapter requiring a session;
  construction alone no longer validates; Walker explicitly awaits validation
  before pattern-file reads. No exported public package symbol changes.
- Per-current-path rule batches target 128 predicates/64KiB logical input; no
  speculative VFS reads. Equal adjacent ignore priorities batch together; lower
  priorities skipped after a match remain skipped. Native Workers are reused,
  not created per filename. Leases end before VFS/stdin/sink awaits.
- Raw glob strings, separately copied flag objects (32 accounted bytes each),
  and UTF16LE path bytes use the existing FIFO, byte accounting, signals and reply
  validators. Boolean replies are zero or one `[0,0]` range. Existing pattern,
  ignore-file, file-entry, line, result and output limits are not weakened.
- Invalid ignore-file parsing still reports/discards that file. Worker resource
  and transport errors instead stop traversal. Abort checks precede ENOENT
  classification, retaining errno-shaped cancellation identity and stopping
  further VFS calls. Command session acquisition is explicitly inside try/finally.

Defaults are unchanged and ACTIVE: 1000ms active / 3000ms startup, maxWorkers 2,
64 queued requests / 128MiB queued input, 100ms idle retirement. Construction and
plugin registration create no Worker. Public configuration remains
`standardCommands({regex})`/`createStandardCommands({regex})`,
`searchCommands({regex})`/`createSearchCommands({regex})`; aggregate rg forwarding
is `agentCommands({search:{regex}})`. There is no aggregate top-level `regex`
option. No aggregate option or export was added to disguise this fact.

## Unresolved public cleanup: exact minimal proposal

Repro remains the original actual public call:
`new Shell({fs:new MemoryFileSystem()}).use(agentCommands())`, then
`await shell.exec("grep -E '^a' | head -n 1", {stdin:'ab\n'.repeat(200)})`, then
`await shell.dispose()`. Output is `ab\n`, status 0, stderr empty; exact Worker
exit is still pending at both public boundaries. The corresponding rg command
has the same failure. All exact Workers eventually exit: not an indefinite leak.

`grep.ts:87` and `search/rg.ts:167` await session.close in finally, but
`shell/runtime.ts:870` races dispatch via interruptible; pipeline stage/aggregate
at :345/:371 and `shell/shell.ts:107` race again. `shell/shell.ts:138` dispose
awaits plugins, not losing command finally blocks. CommandContext signal/invoke
and plugin-wide dispose cannot express awaited *earlier public exec* settlement.

Proposal agreed in root/reviewer notes, **NOT approved or implemented**:

```ts
export type InvocationCleanup = () => Promise<void>;
export interface CommandContext {
  readonly registerCleanup?: (cleanup: InvocationCleanup) => void;
}
```

Shell supplies a distinct per-dispatch registration scope tracked by parent exec
across nested invoke/pipelines/substitutions. Register idempotent session.close
synchronously after open and before first run (open acquires no Worker). Close
admissions on interruption/settlement; reject late registration synchronously.
Drain once before public exec settlement; dispose awaits outstanding drains.
Drain all registered cooperative terminators even when one rejects, never
arbitrary handler/FS/input/sink promises. Preserve original caller abort identity,
else original execution rejection, else reject cleanup failure (AggregateError
for multiple). Normal finally and host drain share the same close promise.
Custom contexts may omit the capability and retain direct-handler semantics.
Root must assign contract/runtime ownership separately; no local workaround.

## Evidence and limitations

| Cohort | Result |
| --- | --- |
| Final original author + followup + new scoped tests | **76/76**, no skips/TODO |
| Final scoped TS and production build | pass |
| Moved npm Node22 ESM public controls | **35/35**, 12 Workers, exact cleanup |
| Moved npm early-EOF lifecycle | **3/7**, four required cleanup assertions FAIL |
| Final packed lifecycle workers | 2 eventually exit once, zero safety terminations |
| Existing related grep/search native tests | **110/111**, one failure retained |
| Ten tiny glob dialect probes baseline → candidate | **10/10** exact triples unchanged |
| Same ten probes versus native Darwin rg15.2.0 | **6/10** exact triples |

`final-author-cohort.json`, `final-types.json`, `package-build.json`, and
`final-package-evidence.json` preserve commands, outputs and identities. Actual
tarball was extracted into a separate consumer package boundary, physically moved,
and resolved through `virtual-bash`, not a source alias. Sixteen emitted JS/type
asset hashes match dist, declaration consumer passes, runtime dependencies are
empty. Archive SHA256:
`ff1a07b65945752c5505b4964de81dbc911e0adf078d30c756c45c928d810033`.
Package runner status 0 is assembly/control success, NOT its lifecycle child
(status 1) or public-cleanup acceptance. No forced cleanup/child kill was needed.

First wrapper arity build error (`after-build.json`), first consumer isolation
failure (`moved-package.json`: self-reference escaped to checkout), and second
consumer option typing failure (`corrected-moved-package.json`: invented top-level
aggregate regex option) are retained. Corrected consumer uses a differently named
package.json boundary and inspected `search.regex` API; no product API workaround.

`related-tests.json` retains the failed `gitignore requires git by default`
comparison. Native fixtures were forced inside this repository using TMPDIR, so
an enclosing real `.git` exists while virtual `/work` has none. This is an
unresolved native-fixture profile failure, not silently dropped or fixed by
changing product semantics/assertions. This scoped run is not a full gate.

Native profile in `dialect-evidence.json` explicitly disables parent ignore/config,
uses byte-sorted paths, and records actual Darwin rg15.2.0 output. Preserved
differences: globstar dot does not cross newlines; Unicode `?` consumes a code
point rather than native globset's observed byte behavior; malformed class
diagnostics retain prior parser/V8 wording. Nested braces and POSIX class spelling
probes happen to agree in this native version. These are tiny benign tests, not
adversarial stress, universal dialect parity, or a named-backreference migration.

Primary references consulted: Node v22.19.0 worker_threads manual (terminate's
exit promise, pooling and JS-resource-limit exclusions), ripgrep 15.1.0 GUIDE and
globset source. Local runtime is Node v22.22.2; native is rg15.2.0, not those doc
version numbers. URLs: `https://nodejs.org/download/release/v22.19.0/docs/api/worker_threads.html`,
`https://raw.githubusercontent.com/BurntSushi/ripgrep/15.1.0/GUIDE.md`,
`https://raw.githubusercontent.com/BurntSushi/ripgrep/15.1.0/crates/globset/src/lib.rs`.

Capture files record shared HEAD/status and SHA256 for tracked source before/after
each command. Final scoped tests/types/package each report no tracked-source drift
during that check; the overall checkout is dirty/cohosted, not globally frozen.
Foreign staged/untracked work is not owned, included in this commit, or certified.
Independent verifier owns final public cancellation/lifecycle replay and the
32-file equivalent-output timing cohort (three alternating pairs). Those results
are pending at handoff; no speed, superiority, fullgate, 72-hour or completion claim.
