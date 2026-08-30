# Frozen review procedure v1 — execute only after root resumes

## Input selection and package boundary

1. Authenticate INPUTS, original Phase1/Stage2/policy seals and this freeze commit
   before candidate inspection. Recheck exact prior membership, including new
   entries, after work. Preserve the initial foreign index/status, without reset,
   stash, broad staging, private writes or deleting foreign locks.
2. Bind exact candidate 618d8967009117547ab476256bc6eb0a9463309a and author
   evidence cb94b17d0eefc62e2a51f5a6f7cf46ebbcad2faf. Authenticate candidate's
   own source delta ONLY runtime.ts/shell.ts; verify both against eba baseline
   SHA256s and all 243 protected paths against the later baseline metadata.
   The full eba-to-candidate tree has unrelated earlier changes; do not mislabel
   it or alter the actual candidate to manufacture a two-file whole-tree delta.
3. Use a committed archive of the actual complete package and required committed
   suites, with no live product/test overlay. All scratch, captures, package
   installation and movement stay inside this owned subtree in isolated regular
   directories. No shared dist or private writes. Record exact Git tree/blob and
   SHA256 inventories, archive hash, modes, links, tooling versions and hashes,
   full commands, exit statuses, signals, stdout/stderr and before/after membership.
   Authenticate author metadata separately where it postdates candidate source.
4. Build the full package, pack it, install the resulting real tarball into an
   isolated consumer, then move the installation and consumer to another regular
   directory. Run public package Shell consumption there. Record package/tarball/
   declarations/import closure identities. Positive controls must load installed
   public Shell; negative load controls must reject live/source/internal fallback,
   missing or wrong installations. Merely moving dist or an internal module is
   insufficient. Build before worker-dependent legacy suites; preserve failures.
5. Compile strict positive and intentionally malformed-negative consumers against
   those actual installed declarations, with no source paths/shims or ambient
   fallback. Bind the existing ShellOptions/exec limits, ByteSource/ByteSink,
   CommandContext.invoke/CommandInvokeOptions, mutable context.env and zero-arg
   middleware next() shapes. Negative fixtures must fail for the targeted type
   defect, not module-not-found/tooling failure. No new public APIs or limits.

## Existing bounded controls, not a new large matrix

Reuse all 16 original N scripts and I01-I12 definitions by frozen hashes, keeping
their denominators. Materialize existing productScript/fixture bytes only after
resume. The two original VFS fixtures map to /review-stage2 paths exactly; script
source/redirection effects are harness/shell effects, not builtin IO. Apply ONLY
native-corrections-v1 to the selected native oracle; product-policy evaluations
must be separately labeled. No blanket diagnostic relaxation or all-green native
rescore. Native profiles remain Darwin Bash5.3.0(1) and Bash3.2 separately; reuse
authenticated existing captures first. Any needed bounded rerun uses those same
scripts, exact binary hashes/profile/env and fresh output, never a new cohort.
Unavailable pinned binaries are unavailable evidence, not silent substitutes.

| Original controls | Bounded review obligation |
| --- | --- |
| N01/N02; I01/I02 | Regular builtin discovery/direct/command and same-name function bypass; no aggregate plugin registration; fresh defaults/export attributes vs clone/invoke state. |
| N03/N10/N14/N15; I03 | Successful scalar origins, aliases and integer-binding profile; failed external stores do not reset; same-value script assignment does. |
| N04; I03/I12 | Exact same-scope visible/hidden prefix restoration on success/failure/abort; deliberate native divergence, not native equality. |
| N05/N06/N09/N15; I04 | Corrected repeated bare local; function-entry snapshot survives repeated locals; rejected locals do not create restore ownership; dynamic OPTARG/OPTERR and positionals/set/shift are not resets. |
| N07/N08; I04/I10 | Deep clone subprocess/pipeline/substitution/invoke; share source/eval/group; child/sibling/parent and fresh-state isolation. |
| N11/N12/N13/N14; I05/I12 | Late names/readonly checked fail-fast, exact partial publications, attributes, status and diagnostics; continuation observed without new inspection API. |
| N10/N16; I06/I09/I11 | ASCII options and Unicode values; exact diagnostics vs zero silence writes; no getopts stdin/VFS/process/network/stdout IO. |
| I07/I08/I09/I10/I12 | Existing host API-shaped budget/abort/sink/overlay/literal-invoke controls below; add only bounded missing controls, not duplicate cohorts. |

## D02 concrete approved host binding

- Reuse the same Budget: normal executeCommand tick once, normal yield every128
  commands, and normal command TARGET nested dispatch charge. No extra getopts
  command/loop charge or family/global work/deadline API. Functions/invoke share
  accounting; observable exhaustion must include prior command/output consumption.
- Expansion bytes are PER WORD, not summed argv; expansion fields bound admission.
  Already selected positionals/middleware operands receive existing byte/field
  checks without reparsing/re-expanding or double-counting. Each optspec/argument
  is at most B=maxExpansionBytes; A is admitted selected argument count.
- Private per-call maxArguments=maxExpansionFields,
  maxBytes=saturating(B*(A+1)), maxSteps=saturating(2*B*(A+1)+A+2).
  Inspect and check safe saturation before lossy multiplication/addition; bound
  edge probes rather than allocating huge fixtures. Per-call helper caps do not
  reset the shared Budget or turn bytes into commands. No new global work/time
  guarantee; real timeout is a caller AbortSignal.
- Private helper checkpoint every128 steps and final nonempty flush must use
  interruptible setImmediate with signal checks, not only Promise microtasks.
  Check admission batches where applicable. Pending work cancellation must be
  observable; preserve original reasons including object,false,0,"",null.
- Frozen publication: completed scan -> signal check -> hidden cursor -> awaited
  nonempty parser diagnostic -> signal check -> checked OPTIND -> checked OPTARG
  set/unset -> late validated checked name. Earlier effects persist, later writes
  never occur after diagnostic failure/abort; observe late rejection and prevent
  late resolution from publishing. Silence does zero parser writes.
- Existing mappings remain: ShellLimitError propagates; caller reason identity;
  ordinary error status1, EPIPE141, CommandFailure's status where existing runtime
  applies. Arbitrary sink error need not publicly reject Shell.exec unchanged;
  failure-diagnostic behavior is part of the existing mapping. Do not convert
  sink/shared-limit/helper/checkpoint errors into generic usage2 or fabricate a
  public work-limit error. Author ASCII status2 is a documented claim to verify.
- Use gated/rejecting/closed existing ByteSink shapes and real public Shell paths.
  Preserve byte ownership/backpressure, budgeted ownedOutput callbacks, capture
  ordering and cleanup settlement. Any narrow internal observation is separate
  instrumentation, never a substitute for installed public proof or new API.

## D03 concrete approved host binding

Use actual registry middleware and context.invoke, not a stub. Invoke deep-clones
cursor/saved state, removes ONLY previously exported bindings, validates/installs
env, replaces export set and clears local restore frames. Compare final binding
presence/value, NOT transient deletion, object identity or options.env alone.

| Base binding | Final operation | Required child behavior |
| --- | --- | --- |
| Exported v | Unchanged merge/forwarding or explicit same v | Preserve cloned cursor; no reset after delete/reinstall. |
| Exported v | Replacement omission (also env omitted) | Remove binding and reset child; no default insertion/PWD injection. |
| Unexported v | Omitted key in merge or replacement | Retain unexported visible binding and cursor; no promotion. |
| Unexported v | Explicit same v | Export promotion only, no cursor reset. |
| Present v | Explicit different w | Reconcile child only from final binding. |
| Absent | Still absent | Preserve cursor; not a removal event or fresh initialization. |
| Absent | Explicit v | Reconcile child installation only. |

Undefined env values are invalid, not deletion sentinels. Copied unchanged
context.env is forwarding, not script assignment. Missing forwarded exports can
remove a child export even under merge; unexported base values survive. No parent
mutation channel on success/failure/abort, no sibling sharing. Literal metacharacter
argv is not parsed. Preserve stdinIsDefault provenance and actual supplied signal.
Direct middleware is not automatically a child clone: retain the existing
conditional restoration only when value still equals saved overlay; pair hidden
snapshot restoration with that branch, never impose unconditional restoration.

## Regression and SafeJS evidence reuse

Run existing scoped runtime author/state/core/owned-output suites from committed
inputs, using baseline.json's exact command inventories where applicable. Reuse
the existing independent 36 owned-output holdouts without changing assertions.
Their author reruns remain author evidence. Document overlap between claimed83
runtime,505 core,203 state,42 owned,36 holdouts,9 moved and25 SafeJS; never add them
as unique tests. Run smallest relevant checks before broad scoped regressions,
and report source defects promptly to ROOT; no implementation fixes authorized.

SafeJS only as needed, using authenticated current legitimate runtime on REGULAR
copies and existing explicit host hooks. Guard private HEAD/tree/index/status,
metadata and engine inventory before/after, copy only permitted inputs, never
write/install into private repositories/module trees or vendor engine bytes.
Retain prerequisite/load identity/watchdog/output/heap/settlement checks; stop on
drift/unavailable prerequisites. Existing author25 qualified profiles are not25
successful guest-capability proofs. Separately record which actual guest actions
succeed, which failures are expected controls and what remains unproven. No public
guest capability claim from supervisor success alone.

## Reproducibility and remaining stop conditions

Candidate currently has main reachability and INPUTS contains raw commit body.
On resume authenticate that body with Git object framing/hash and bind all selected
tree/blob inputs. If detached/synthetic or future clone would lack inputs, persist
a self-contained bundle/object archive in this owned subtree with a complete
inventory plus exact reconstruction commands and test in an isolated regular Git
directory; reconstructed commit/tree IDs must equal the original. An archive
without commit/tree metadata is not proof of exact commit reconstruction. Do not
create user branches or assume dangling objects survive cloning/garbage collection.

Every obligation above is PENDING, except first-phase metadata/seal checks clearly
recorded in VALIDATION.json. Freeze commit grants no automatic resume. Stop and
report conflicts, unexpected membership, drift, source defects or unavailable
prerequisites without rewriting controls. Later failures/corrections and each
attempt's raw data must remain beside successful attempts; no global gate claim.
