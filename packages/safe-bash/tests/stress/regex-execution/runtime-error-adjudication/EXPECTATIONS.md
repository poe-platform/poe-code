# Independent error-layer adjudication: frozen expectations

Frozen before reading the main leaf's supplemental source or findings on
2026-08-27. This verifier owns only this new directory; the original fixture,
source, contracts, and other evidence remain untouched. The user additionally
authorizes the two `/tmp/regex-runtime-error-*.txt` handoff files.

## Inputs and question

- User-selected runtime: `1b133a8662a32ee84524794842074c9c98d5f6c3`;
  registration: `01aa1bffe0568cc6787d5ff8e0331e024a787385`;
  prepared fixture: `10273352f8d65d929cbf5a23e69119414dacee60`.
- Current compiled input is the main leaf's frozen
  `cleanup-boundary-review/.temporary/runtime-r1`, subject to its recorded
  freeze/build hashes. Inspect historical source through immutable Git only.
- Reported original observation, not independently certified here: group
  `public:primary-error-and-abort-during-drain-identities` fails for caller
  `none` at runtime.mjs:104, receiving `AggregateError('Invocation cleanup
  failed')` rather than the exact `Error('selected execution failure')`.
  Preserve its assertion body and reported 7/8 outcome; no rebaseline approved.

## Expectations, fixed before investigation

1. Determine independently whether an ordinary registered handler throw was
   already converted to stderr/nonzero result before this runtime change. If
   so, a completed nonzero result is not an execution rejection; that fact
   cannot itself justify discarding a subsequent cleanup rejection.
2. Inspect the normative cleanup precedence contract and actual old/current
   public Shell dispatch/exec paths. A genuine selected execution rejection
   must retain exact object/value identity after awaited failing cleanup.
3. Caller cancellation during cleanup must retain its exact selected reason,
   including an errno-shaped object and falsy reasons where applicable. A
   passing first branch must not conceal unexecuted later branches.
4. Preserve ordered/awaited cleanup and strict rejection observation in the
   controls. No production repair or canonical fixture rewrite is authorized.

## Bounded execution envelope

At most four small groups, with explicit static variants: (1) ordinary throw
without cleanup, including an immutable pre-change comparison if available;
(2) ordinary throw with cleanup, including the exact original failing
assertion; (3) genuine public execution rejection with cleanup, using the
existing rejection path identified by source inspection; (4) caller abort
during drain with errno/falsy identity variants. No regex risk probes, broad
tests, original public-five reruns, dependency changes, hidden expansion before
the first read, or broad process kills. Use existing frozen compilation/local
tooling, strict unhandled rejections, finite output, and one known child.

## Disposition rules

If a source bug is found, immediately record its concrete source hash and
reproduction in `/tmp/regex-runtime-error-findings.txt`; do not fix it. If the
original assertion targets the wrong layer, explain exactly how a proposed
control reaches an existing genuine rejection path; preserve the original.
State whether meaningful approved benign precedence obligations are covered
and green, or a gap remains. Neither answer authorizes a risky gate.

Keep reported historical `99/100`, `110/111`, and old-five `0/5` separate from
reported new-five compiled `5/5`, packed `5/5`, and their `24` triples each.
These are context supplied by the user, not independently rerun or certified.
