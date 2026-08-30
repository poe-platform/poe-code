# Bounded internal-loader repair preparation

Scoped harmless qualification complete; public80 remains HOLD. No product imports,
build/install, RegexWorker, native oracle, private source or actual-v1 retry ran.
The original actual-v1 commit7bd3fc8e remains consumed and unchanged.

## Why the distinction matters

The actual pinned Node22.22.2 custom-loader launch requires the backend Worker
capability before the main-context resources bootstrap. Official Node HooksProxy
source describes a separate InternalWorker for module hooks. PRIMARY-SOURCES.json
records official references and a qualification: the fetched tag source has a
bypass comment/different line numbers, so it is not claimed as compiled-binary
provenance. Captured behavior and the executable hash govern this result.

The repair helper admits only the exact finite reporter/loader/consumer argument
vector. Parent admission binds loader URL/path, regular-file identity and bytes,
bootstrap/consumer identity and finite environment. Main bootstrap installs the
application-Worker guard before consumer imports and updates ESM/CJS builtin
exports. A Node backend permission flag is NOT a promise of arbitrary application
Worker access or a hostile-code sandbox. Worker permissions do not supply full
OS/network/race-proof isolation; actual sources/options remain hash-bound.

## Preserved initial result

Preseal bd4bada2; CONTROL-SEAL.json SHA
ab22dc48d9e9d809c4815bc7a02f04b4cf04580f1c1acd5ca6c6acdbd1bfdb4c.
Initial coordinator exited1:14PASS/8FAIL.12 parent admission controls and the
expected loader-denial/bootstrap-error cases passed. Eight consumer paths failed
on a missing closing brace in this reviewer's inert consumer. All10 child
processes closed naturally;9 loader starts were recorded;0 application Workers
were created. The results/source are preserved, not relabelled or repeated.

## Versioned correction

Preseal bd6a1863; CONTROL-SEAL-V2.json SHA
274d1553b23af283c81245842a214c6128060ae873f56676052422ebda378005.
New consumer-v2 closes the brace. It places the same six option refusals BEFORE
worker construction, preventing an exhausted allowance from masking option checks.
Three explicitly regrouped controls ran,3PASS/0FAIL, coordinator0:

- R01: internal loader starts, main bootstrap precedes consumer, undeclared
  application Worker is refused before construction; child0.
- R02: six malformed options and a wrong entry are refused; exact ESM/CJS Worker
  identity is shared; one fixed harmless Worker emits its value and exits0. The
  consumer then emits PASS but exits7, which remains explicitly nonclean.
- R03: separate exact app-only/no-custom-loader role; one fixed harmless Worker
  throws the owned sentinel and exits1, observed by the consumer; parent exits0.

This is NOT22 fresh green groups. The14/8 predecessor and its coordinator1 remain.
The new three groups combine mechanisms without claiming every old recipe reran.
Consumer/coordinator/proposed-run syntax checks are separately source-only.

## Exact Worker and closure scope

Across both cohorts:12 internal-loader launch attempts,11 observed loader
initializations,2 application-Worker creations and2 corresponding exit events;
0 product RegexWorkers. Original P01 was denied before initialization.13 harmless
Node child processes closed naturally; no cleanup signals were sent. Both
coordinators closed. Internal loader exit events were NOT observed or invented:
hosting-process retirement is the available qualification. Thread IDs are
process-local, not a global identity/census.

Source and fixture hashes match their seals after execution. Generated negative
loader copies and the contained symlink were preserved as DATA then removed;
all raw captures and immutable predecessor artifacts remain. No safety/capture/
integrity/unknown-retirement event occurred in this preparation. The failed first
consumer was an ordinary fully captured syntax defect, not a product finding.

## Source-only successor proposal

RUN-SUCCESSOR.mjs.data is NOT an executable release packet. SOURCE-CORRESPONDENCE
proves exactly three declared differences from the frozen runner: the tested
argument-helper import, guarded role/file/argument admission, and an honest loader
admission counter label. All other runner logic remains byte-equivalent under
reversal. Its syntax was checked without module linking/evaluation. Existing
product RegexWorker policy/options/static four-file closure remain unchanged.

FUTURE-PROFILE.json explicitly separates32 admitted loader-process roles from the
existing32 cumulative RegexWorker ceiling/2active cap. Proposed resource accounting:
43 direct children +32 loader admissions +32 maximum RegexWorkers =107;3 inner
reserve +18 outer/controller/admin reserve =128. Peak4 refers to OS processes,
including the capture owner, not all native threads. Future internal-loader
counts are admissions/source expectations, not newly observed per-thread exits.

Remaining barriers: a new complete execution packet/unused namespace must bind
this source/helper/profile with all inherited inputs; the full successor runner
and its binding-negative interactions remain source-qualified only. Fresh ROOT
actual GO is mandatory. No build or candidate run is authorized by these files.
The previous package950/build qualification and0-semantic actual-v1 HOLD remain.
