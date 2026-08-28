# Independent pre-code contract: jq string length

August 28, 2026. Reviewer-owned scope only. This packet is not authored by the
proposer and does not implement the product repair. Freeze this packet before
the author receives implementation go-ahead; retain its Git chronology.

Proposal: `debfdd8b42930d8c5f1c0301897e4eeaa68e0979`, README SHA256
`f97311654ee5ef5a8a97d4f0bb1f0036209c2fe342b19774b568b90cfdcdf6e4`.
Accepted source baseline: `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
Interpreter SHA256:
`bac1cf5325eff5bfa69f1c8bec5d3d8a80bb452fd61cdc802d55a26788acaffc`;
Git blob `f7e0dfcb1815aa90ae49d495e453b4d069139108`.
These bytes still match the observed current source before this freeze.

## Author-facing requirements

Only the string arm currently reading
`else if (typeof input === "string") yield Array.from(input).length;`
may change. Count synchronous JavaScript string-iterator elements without
retaining them. No additional charge, guard, signal observation, await, scheduler
yield, helper/API/import/export, surrounding branch or yq change. No root wiring.
This is an allocation-shape repair, not a preemption, RSS or memory-usage bound.

The literal 17-string matrix is independently selected: empty/ASCII/control,
astral, composed versus combining, ZWJ, flag/modifier, variation selector,
unpaired/reversed/mixed surrogates and Unicode boundaries. Internal lone-surrogate
vectors are not promoted to accepted public JSON. Expected numbers are literals,
not derived using the product or Array.from. Twelve non-string controls retain
null, numbers including negative zero/NaN/infinity/Decimal, arrays, sparse arrays
and object data. Both booleans retain the exact JqError message/status.

Each direct `Interpreter.run({kind:"call",name:"length",args:[]}, input)`
first result fits **maxSteps:1**, with one tick and one unit charged; completing
the iterator introduces no extra charge. A subsequent explicit step must hit
the old maxSteps limit. Pre-aborted errno/null/false/0/empty-string/Symbol reasons
must reject by identity at the existing entry tick. Full public-command budget
thresholds are deliberately not inferred from this seam.

Trusted-host String iterator controls remain isolated in child processes. The
sentinel iterator yields three arbitrary values for a two-code-point string,
can end empty or throw an errno-shaped marker, and can abort during its first
next call. Existing behavior counts iterator elements, propagates iterator
failure and does not add an abort observation within the synchronous count.
A queued microtask must remain after all iterator steps. This is not a sandbox
guarantee for hostile host prototypes or a request to await opaque work.

## Noncollection discriminator and controls

Compile and bind actual modules first. In one tiny child only, wrap Array.from
so the exact literal `L😀é` throws a private marker; delegate every other input.
The wrapper's direct negative control must trip. A fixture-only synchronous
counter must return 4 without tripping, and an unrelated Array.from([7]) must
still work. Evaluate the actual bound interpreter last. Old code must trip the
same marker with a stack in the authenticated interpreter.js; a repaired
candidate must return 4. Restore the complete original descriptor in finally.
No large input, global-spy attribution to unrelated work, native jq or RSS proof.

The baseline's collecting outcome is an **unmet desired property**, not a green
noncollection result. The counter is a test-instrument control, not a product
prototype or approved implementation. Once the author supplies a committed
candidate, the reviewer must restore only the old string arm in an isolated
candidate source copy, compile it and show the discriminator fails again. That
real candidate-reversion mutant is **pending**, not claimed executed pre-code.

## Execution and review phases

The runner will copy only selected committed regular source/config/test blobs,
never AGENTS, .git/history, private repositories, or a mutable source overlay.
Build into unique temporary directories with authenticated installed tools;
record source/build/module/runtime hashes before and after. Move the actual
built package into a separate consumer node_modules directory with its original
package.json. Test root resolution, real direct command queries and a real
Shell pipeline with VFS input/result preservation; no source fallback.

Existing regression scope: the unchanged semantic matrix and non-native
prototype/order cases; the exact two resource tests named by the proposal.
The native-oracle test and hazardous-expansion child cohort are not selected.
The selected Cartesian check has 4096 bounded results; no new expansion bomb
or native executable is introduced. Report selected versus nonselected counts,
not blanket structured-suite acceptance. Original regression hashes stay fixed.

After baseline validation, publish observations separately from this freeze.
Await the author's candidate before actual independent repair acceptance. Any
fixture error receives an explicit versioned rationale; do not quietly rewrite
this freeze. Any source correction returns to the author and requires re-review.
