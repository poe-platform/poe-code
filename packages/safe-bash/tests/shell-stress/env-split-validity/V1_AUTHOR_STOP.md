# V1 author stop and additive v2 binding correction

V1 fixture freeze: `f2906a064d2558c634cdc1b71a7b74fd2f6d022a`.
The complete raw author attempt is `author-run-v1.json`, August27,2026,
11:27:47.258–11:28:14.723 UTC. It STOPPED, not accepted. No v1 file is corrected
in place. All108 child processes ended without watchdog intervention; scratch
was removed and all frozen/original hashes remained unchanged.

Before the stop, both complete hidden profiles ran (primary40/48 overall,
39/42 command; historical23/48 overall,22/42 command), and all7 hidden hosts
passed. Archived-source build, original tgz installation/move, actual compiled
imports and positive/negative moved declaration checks completed. Only the first
of10 consumer native rows ran; none of the consumer host or additional controls
ran. Those unexecuted slots are NOT passes.

The first consumer's actual env/record work produced the original expected
stdout and unchanged phase bytes/mode, but the new v1 boundary assertions threw
three times. Actual tuple: status1; exact stderr is stored in the raw artifact.
All three messages identify `[Object: null prototype]` versus a plain object.
The revised fixture compared live context.env directly with its plain-object
snapshot. Frozen runtime.ts:798 creates context.env with `Object.create(null)`;
contracts/command.ts:30 promises a string-keyed Record, NOT Object.prototype.
The already captured before/after environment entries were exactly equal.
This is a new AUTHOR fixture mistake, not a fourth original verifier defect and
not a demonstrated product/environment mutation. No original unknown stderr is
inferred from this new observation.

V2 makes only these semantic fixture corrections:
- Compare `{ ...context.env }` with the same exact key/value maps in the two
  newly added assertion sites, matching the unchanged capture representation.
  No key, value, status, byte, effect or original assertion is removed.
- Include `export` in the exact reached middleware lists for budget/cancel.
  V1's first actual invocation records the setup export through middleware;
  the v1 lists accidentally omitted it. The source, three-command setup offset,
  original4-command budget and all reached tick/reason checks remain unchanged.
  Those two host executions had not yet run: no host stderr/result is invented.

`consumer-v2.mjs` and `run-v2.mjs` are additive. The runner only changes its
fixture version, consumer binding and new output name. `freeze-v2.json` binds
the new files AND the complete immutable v1 fixture/failure. It is committed
before v2 product execution. `v1-v2.diff` records all executable changes.
All original primary/historical tuples, three diagnostic profiles, unsupported
shebang accounting and source/tgz hashes are unchanged. The v2 author run is
still NOT independent acceptance. A product bug would stop further revisions.
