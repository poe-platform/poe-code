# Successor-v2 admission and evidence boundaries

This is SOURCE/DATA preparation only. No actual-v2 activation is authorized here.

## Internal loader versus application Workers

The exact admitted launcher is the pinned Node22.22.2 executable, a finite argv
vector constructed by internal-loader-arguments.mjs, the fixed loader.mjs URL,
resources.mjs bootstrap, and a single authenticated consumer. Normal vectors are
--test-reporter=tap --loader LOADER CONSUMER; the maintained role additionally
has --test-timeout=30000 before --loader. No other loader/options/preloads are
admitted. The launch prefix has the owned-root read/write permissions,
--allow-worker, and --import RESOURCES. Node needs the internal-loader facility
before the main-context bootstrap. That flag alone is not an application policy.

The main bootstrap replaces the CommonJS Worker constructor and synchronizes ESM
exports before consumer loading. Only maintained-four-bodies has application
allowance; all other guarded roles have zero. The application entry is exactly
dist/commands/regex-execution/worker.js in the authenticated package. Its four
static closure members, bytes, and import inventory remain bound by resources.mjs
and the retained WORKER-CLOSURE-v3.json receipt. Options are exact own-data fields:
execArgv=[] and resourceLimits={maxOldGenerationSizeMb:128,stackSizeMb:4}; extras,
accessors, wrong entry, wrong values and exhausted allowance are refused. Maximum
32 cumulative RegexWorkers and two active; no application Worker acquires a new
loader via options. This is trusted-source admission, not a hostile-JS sandbox or
runtime all-module trace. Existing Node builtins and Python dependency-identity
qualifications are unchanged; no new tool/image permission is introduced.

## Counts and observation

43 direct coordinator children are fixed: four setup/tool roles,21 layout roles,
six type groups, one maintained compilation, two maintained consumers and nine
loaded mutant/restore/binding roles. Exactly32 labels can admit internal loaders.
43+32+32=107 conservative resource units; three inner reserve and18 outer/admin
reserve keep the aggregate at128. Worker threads are not OS processes. The OS
ceiling is128 cumulative and peak4 including capture owner; dispatch stays serial.
All actual timing includes publication/cleanup:60minutes,30seconds ordinary child,
120seconds designated setup,5seconds cleanup. Child raw224MiB +outer16MiB +sidecar
reserve16MiB =256MiB. Inner work960MiB +outer64MiB =1GiB. No hardRSS/OSquota claim.

Harmless repair evidence has12 internal attempts and11 loader-start witnesses.
The shipping loader has no added per-Worker lifecycle hook: its counter denotes
admission, not observed start or exit. Main bootstrap/load traces witness progress;
known hosting-process close establishes that process retirement, not independently
observed internal Worker exit events. Application constructor/exit pairs remain
required. No universal descendant or independent internal-lifetime census.

## Immutable history and peer review

CONTROL-COVERAGE-MAP.json maps all eight original failures without changing their
status. Three corrected controls are not a22/22 rerun. P09's combined custom-loader
plus error-Worker configuration remains unexecuted; R03 proved the app-only error
route. Initial14PASS/8FAIL coordinator1, versioned3PASS coordinator0 and separate
3DATA hash checks remain distinct. The original112989184-byte whole-buffer binary
hash was method-noncompliant; only the later source helper uses bounded64KiB reads.
No earlier execution is retrospectively compliant. Actual-v1 remains consumed/HOLD.

Plato's independent narrow-repair review is separate. This assembly introduces no
new harmless/real Worker execution. Fresh root GO after that review must bind this
execution seal, exact unused actual-v2 namespace, and both Worker ceilings. Template
nonce/expiry/preparationOnly fields are deliberately invalid for launch.
