# Ordered Bash redirection shorthand author profile — August 29, 2026

Baseline: exact public80 derived tree c83f352f057c64917f219eb938f54aa42cdab829,
SOURCE14a2a6a5, full950 package4671ed60. Independent baseline review remains
separate. Add ONLY src/shell/parser.ts, runtime.ts and display.ts. No other internal
type file is needed: Redirect's optional implicitPipeline marker lives in parser.ts.
No root/package/default80 changes, strict-mode changes or new dependencies.

`|&` lowers to an implicit final numeric2>&1 in the existing redirect list. It is
applied after every explicit redirect, including opening/truncating files whose
descriptor is later replaced. Display preserves the pipe spelling rather than
printing the internal duplicate. `&>` creates one normal stdout file writer and
sets stderr to that same writer. Existing output reference cleanup, serialization,
byte charging, cancellation and error mapping are reused. No extra sink close,
background `&`, `&>>`, dynamic descriptor/exec, nounset or conditional grammar.

## Pre-execution commitments

Seal source commit, derived canonical tree/witnesses, all292 source inputs,
fixture/helper/tool bindings and this recipe before --run. Authenticate unchanged
baseline source for every input except the exact three new blobs. No rawHEAD
build or instruction-file materialization. Derived tree identity is recomputed
from authenticated opaque tree witnesses; stored blob identities remain verified.

One author attempt: <=45minutes inclusive of cleanup/publication,96 all owned
process/thread admissions,peak4,128MiB captures,768MiB scratch,case30s/build120s,
<=24 internal loader admissions and <=8 selected RegexWorkers. Actual direct
children/loader reservations/worker events are reported separately; no universal
OS process census or hard-kernel-drain claim. Existing Node22.22.2, TS5.9.3,
npm10.9.7 and finite type/npm dependency inventories are reused and rehashed.
No native Bash/Git oracle, private engine, network, arbitrary Worker, install
scripts or widening of the prior tool routes. Outer raw capture precedes admission.

Production build once; offline pack/install --ignore-scripts; full tar/header/
member/mode/length/hash checks; real physical move. Source/installed/moved each:
36 literal ordering cases +12 boundary cases; unchanged Git-public45, apply28,
arrays12 and selected coherence18; one strict positive/six-diagnostic negative
public type pair. These are scoped regressions, not the whole505 shell suite or
old M1A/native acceptance. M1A's obsolete absent-export fixture is not selected.

Three loaded compiled mutants: omit implicit duplication, move it before explicit
redirections, omit stderr file alias. Each must fail its declared case; exact
restored bytes rerun that case. Two package binding denials preserve source/no
fallback checks. A separate source-bound compiled instrumentation case observes
one file-reference release; this is instrumented lifecycle evidence, not a native
descriptor/physical-memory claim. Counts: 15 main runtime groups +6 mutant/restore
groups +2 binding negatives +1 release observer =24 loader admissions; six type
children, one each blob read/build/pack/install;34 direct children plus runner/
outer development ownership stay within96. Main/loader/max2 product workers gives
peak4. No regex workload is required by the new operator cases.

Cleanup controls release held writes even on assertion failures. Caller abort
must preserve exact reason. Ordinary sink faults are compared to unchanged
numeric-redirection mapping, not falsely assumed to be public rejection. Output
limits stay errors, prior file creation stays observable, required file writes
survive downstream consumer closure. Actual source/instrumented release counts
are distinguished from custom command cleanup callbacks.

Ordinary assertions aggregate only after owned cleanup. Safety, capture,
integrity, setup admission, deadline or unknown retirement stops without retry;
all original receipts remain. Fixture-only corrections require new versioned
evidence and do not rescore old results. Native parity awaits Faraday's separate
40-case baseline/review grant; these author expectations are not GNU observations.
