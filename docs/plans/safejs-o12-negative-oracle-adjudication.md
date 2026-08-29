# O12: independent negative-oracle adjudication

Date: August 29, 2026. Role: independent adjudicator; Curie remains the author. This report recommends a bounded assertion revision only. It changes no implementation, test assertion, expectation fixture, private export, or production file.

## Decision

**Recommend root authorization for Curie to make a modern, version-scoped oracle revision. No runtime repair is indicated by these two failures.** Repeated awaits of the same rejected Promise must retain the same reason object in the unchanged native fixture. Both the real native Error control and the exact minimal proof objects produce `true` for the two identity observations. The modern source preserves that identity correctly. It must not be regressed to manufacture the historical `false` values.

This does **not** make the minimal proof a complete Error receipt. It still loses exactly the modeled Error tag and stack descriptor. Keep the negative classification by asserting that exact full graph/journal loss, not by demanding a now-incorrect native identity difference. Equal returned values are insufficient evidence of complete receipt equivalence.

The unchanged historical test passes **8/8**. The unchanged H5 test remains **6 pass / 2 fail**, with both original failing selectors intact. This report does not rename that run green, modify its expectation bytes, or claim a revised eight-case suite has passed. Root authorization, Curie's assertion change, fresh source/standard-public gates, independent intake, and the eventual final published all-stack execution remain later work.

## Pinned inputs and scope

- Fresh isolated main clone: `/Users/kjopek/Workspace/poe-code-safejs-o12-oracle-adjudication`; clone followed immediately by `git pull --ff-only`; pulled HEAD `518def9bc43198efcd1da5a927e086fecd33a574`. No branch creation, commit, push, or production overlay occurs in this main tree.
- Curie handoff: `/Users/kjopek/Workspace/poe-code-safejs-o12-final-qa/out/safejs-o12-public-receipts/handoff/manifest.json`; SHA-256 `5080142b0411bd0f27381271451b7caaa724620f0ac30fcd254f372aede86220`.
- Unchanged proposed test: `packages/safejs/test/integration/input-error-projection.test.ts`, SHA-256 `88cc5e1fec7f211e2901f79a7ad322fd39fc389fd23bac79db98d5dcc2965ae8`. Both isolated execution copies retain those exact bytes. The ordered predecessor test remains separately preserved at SHA-256 `2288c0a62314ceb73ce0b991ecaa87618e86bb2245ab5845b0b55d71a383d6a2`.
- Guest source SHA-256 `8344978a75b367325409f07193a28977225c5c833a65e5a14537f2fd9b5cb005`, 3,937 bytes; opaque original expectation fixture SHA-256 `00513a4fddf25e46365c7cd51e981fda86b785f3fdedf8cf85983e6cdc56505c`, 11,720 bytes. Only profile index 1, `reject-right-first`, is executed. The unchanged expectation fixture already records native identity `true`; no fixture JSON change is needed.
- Historical source base `fe5a784c7bcc3a8e89ff4aecd1a947f166d46b6b` with its recorded prerequisites; H5 source manifest `6f58c7ec1dbcd579f9132be1819290bb47d046e75ae7ed6c25249b870f91ee74`, base `6e3733a0df3b764a5d87d5f19fe6142bfed905f1`. These identify the existing Curie standard-build compositions, not the pulled main tree or the final published all-stack runtime.
- User's later coordination identities, final PPR1 `cabdebcc` and PPR2 `31d14e`, and Nash's active clean H5 projection remain recorded but are not substituted into this bounded adjudication. No refreshed final-prerequisite or final all-stack approval is claimed.

All reads are from the pinned handoff, exact explicitly listed standard-build files, Git objects, or this new clone. Original audit payload reads are **zero**. No original audit directory is searched, opened, hashed, or executed. Curie's mutable rehearsal build files are read only after selecting their exact paths from the frozen standard-bundle identity record and must match those hashes; their copied bytes, not their future live state, are the runtime evidence here. No other clone or home configuration is written.

## Independent execution and preserved failures

The complete standard public package entry/core/CLI and three chunks for each runtime are copied byte-for-byte into owned `out/safejs-o12-negative-adjudication/runtime/{historical,h5}/node_modules/@poe-code/safejs/`. Its package manifest is the corresponding unchanged Git object. This is ordinary local package resolution of the **same standard public bundle**, not a custom wrapper, package-only rebuild, private-export injection, generated-chunk import, or bundle instrumentation. All six generated JavaScript hashes per runtime match Curie's frozen identities before execution and are reverified afterward. The test uses only `@poe-code/safejs`; observed public-runtime URLs resolve to those copies.

The four test/config/source/fixture paths are copied unchanged into each owned runtime directory. They are validation evidence, not proposed new main package files. No source-mode reimplementation or patched test is used to obtain the results.

From each runtime root, the executed command is:

```bash
env -u TERM SAFEJS_O12_API=built /ABSOLUTE/NEW-CLONE/node_modules/.bin/vitest run --config packages/safejs/test/input-error-projection.vitest.config.ts
```

The exact absolute argv, cwd, environment, timestamps, exit status, full stdout/stderr, and all typed V8 observations are in `evidence/unit-command-receipts.json`.

| Run                                         |   Exit | Test result                         | Typed child outputs | Interpretation                                                                 |
| ------------------------------------------- | -----: | ----------------------------------- | ------------------: | ------------------------------------------------------------------------------ |
| Historical unchanged standard public bundle |      0 | 8 pass / 0 fail                     |                  14 | Historical negative behavior reproduced, not rewritten                         |
| H5 unchanged standard public bundle         |      1 | 6 pass / 2 fail                     |                  12 | Original minimal negatives fail at full returned-value equality                |
| Independent native controls                 | 0 each | 3 controls, not unit cases          |                   3 | Actual Error and both exact minimal proof reasons retain identity              |
| NEW minimal completed follow-through        | 0 each | 2 controls, not rescued unit passes |                   2 | Fresh completed restore preserves full modern values and its own lossy journal |
| Genuine H5 context conversion               | 0 each | 2 pending + 2 completed controls    |                   4 | Full typed Error, aliases, and exact captured journal preserved                |

There are **26 unchanged-test outputs plus 9 supplemental outputs = 35 typed child outputs**. The two failed H5 unit cases stop before their completed-replay assertions. Their separate NEW completed controls are explicitly additional evidence, not missing historical generations or a reinterpretation of 6/8 as 8/8.

Exact failing selectors:

1. `O12 exact modeled Error proof projection > classifies minimal proof 1 against the same capture and request`
2. `O12 exact modeled Error proof projection > classifies minimal proof 2 against the same capture and request`

Each unchanged failure is at test line 350. Its complete value diff contains only `$.inputOutcomes[0].same: expected false, actual true` and `$.trace[2][4]: expected false, actual true`. Every other original output field, array order, trace entry, balance, closure observation, Promise alias observation, emission alias observation, and returned graph matches the fresh native execution. Full values and typed graphs are retained, not reduced to those two booleans.

## Same-capture and request anchors

One H5 capture supplies every normal complete/minimal/native-fields proof, both independent minimal native controls, both NEW minimal completed restores, and both H5 context-conversion controls. Its V8 SHA-256 is `eadacd9f06265b5a18166bbd73342f52eb3cd26c2c8dd5bf395466c0b6ce54f7`. The rejected input record is `b1c2a97f-66b9-407b-9401-edf304dd84a0:1`, run ID `b1c2a97f-66b9-407b-9401-edf304dd84a0`, source hash `187a3c52`, module `<inputs>`, operation `["bindings","incoming","remote"]`, argument digest `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.

The pending request is asynchronous, `read-side-effect`, lifecycle `running`, and requires `external-reconciliation`. Every proof keeps the exact call ID, source hash, module, operation, and argument digest; the complete request lists match across all three projection modes and the H5 converter controls. Both inputs are reconciled, with zero callbacks. Native controls validate their selected request against this exact captured record before executing the unchanged guest source with the actual selected reason object.

The complete proof is recovered by publicly restoring and running the genuine completed capture, reading the public result's rejected `snapshot.hostCalls` receipt, and dumping that public result. Receipt recovery makes **zero host calls and zero proof requests**, returns the full captured value, and reproduces the exact completed capture. Its decoded reason, `again`, and `nested.reason` are the same object. The minimal proof is explicitly a new `{ name, message }` object; its relationship to that modeled receipt remains `modeledReasonIdentity === false` even while repeated awaits of the projected reason yield `true`.

No brand, graph tag, stack, callback result, snapshot field, or journal field is forged. No private encoder/decoder is imported. The exact child program is extracted from the frozen test's template literal with the installed TypeScript parser; it is not rewritten.

## Exact typed expectations

| Observation                                       | Complete modeled receipt                                 | Minimal name/message projection                                | Native-fields projection                                 |
| ------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| Full returned value vs modern native              | Equal                                                    | Equal                                                          | Equal                                                    |
| Repeated await identity / rejected trace identity | true / true                                              | true / true                                                    | true / true                                              |
| Proof reason is the recovered modeled receipt     | true                                                     | false                                                          | false                                                    |
| Encoded root Error tag                            | `errorType: "Error"`                                     | Own field absent                                               | Own field absent                                         |
| Encoded stack                                     | Exact captured modeled stack                             | Own property absent                                            | Exact original host Error stack, not modeled stack       |
| Captured complete journal equality                | Exact                                                    | Unequal by exactly tag and stack descriptor loss               | Unequal by exactly tag loss and stack value change       |
| Completed replay behavior                         | Same full value and exact own journal; no calls/requests | Same full value and exact own lossy journal; no calls/requests | Same full value and exact own journal; no calls/requests |

The complete captured modeled stack is exactly `Error: right input unavailable`. The original host Error stack is separately preserved in the V8 evidence and includes the actual native eval location. H5 context conversion creates the modeled sandbox stack; in this input context it exactly equals the captured modeled stack. This does not establish general native stack preservation or arbitrary native Error input support.

The minimal encoded outcome is exactly the following full graph, including null-prototype state, extensibility, descriptors, root and node count:

```json
{
  "root": {
    "tag": "ref",
    "id": 0
  },
  "nodes": [
    {
      "kind": "object",
      "nullPrototype": true,
      "extensible": true,
      "properties": {
        "name": {
          "value": "Error",
          "configurable": true,
          "enumerable": true,
          "writable": true
        },
        "message": {
          "value": "right input unavailable",
          "configurable": true,
          "enumerable": true,
          "writable": true
        }
      }
    }
  ]
}
```

Compared with the captured full five-row consumed journal, the **only** minimal differences are:

- `$.calls[0].outcome.data.nodes[0].errorType`: original `"Error"`, minimal own field absent.
- `$.calls[0].outcome.data.nodes[0].properties.stack`: original complete writable/enumerable/configurable descriptor with value `"Error: right input unavailable"`, minimal own property absent.

The other four call rows, all rejected-row identity/policy/lifecycle fields, name/message descriptors, and every other encoded graph field are unchanged. All five calls remain `consumed`. The full initial-input graph is equal to the pending capture's; existing promise settlements retain their exact prefix. Both supplemental minimal completed restores preserve the whole resulting replay and promiseReplay sections, with no host calls or proof requests. Complete proofs and both H5 converter controls retain the entire original consumed journal exactly.

## Why the modern source is correct here

The frozen historical `interp/exceptions.ts` function normalizes an unbranded error-like object into a new modeled Error at each catch boundary. That explains the historical minimal projection's repeated-reason identity loss. The modern function's `sandbox` provenance branch returns a sandbox-origin reason unchanged before the generic error-like host normalization branch. The interpreter passes that provenance through captured exceptions. A plain name/message object rejected by the same Promise therefore stays the same plain object across repeated awaits. The fresh native controls confirm that exact unchanged-source behavior.

This explanation is tied to both captured source and the actual executed standard bundle: historical source SHA-256 `5ed3c8b300df2eb36d8e51afa8cfe6ae9bbe82b7c1c9586d16d9eff4abcdecbf`; modern source SHA-256 `079e267b3c55d4f3dac843c3d70faea15e2fe7cb352ba734b532b8bdbbf89127`. Each matches its Git-base file and frozen contract copy. `evidence/source-contract-binding.json` retains the corresponding unmodified compiled function from each executed bundle.

Relevant frozen source locations: modern `interp/exceptions.ts:175` and `:195`; `interp/interpreter.ts:446`; historical `interp/exceptions.ts:172` and `:191`. The public context contract exposes `toSandboxValue` at `interp/host-call.ts:57`; `interp/host-bridge.ts:374` checks active context/abort state and converts through the runtime's normal graph-aware copy. `snapshot/replay-data.ts:135` and `:149` encode real modeled Error metadata; `:312` restores it. These files are evidence-only copies, not imported private APIs or proposed production patches.

The independently executed, unchanged Curie context variant uses the actual provider's `context.toSandboxValue({ reason: actualError, again: actualError, nested: { reason: actualError } })`. For both repetitions, `callbacks` and `replayed` are empty, the converter is genuinely present, the three reason references alias, and the resulting complete proof's tag/stack/full encoded outcome and entire consumed journal match the original capture. Fresh public completed replay remains exact. No callback-result reconstruction or custom bridge is involved.

The generic raw Error input case remains separate and unchanged: it reports `UnhandledRejectionError` with `Unsupported sandbox value at <root>: Error`, under `jobs-v7`. Its native control does not convert that separate qualification into an O12 failure or fix.

## Recommended assertion delta — not applied

After root authorization, Curie should make a **modern-only successor revision**, preserving all historical capsules/tests/failures byte-for-byte. Do not introduce a runtime-adaptive branch that accepts whichever identity happens to occur. Keep all eight cases and both repetitions of every projection. Do not edit the original expectation fixture.

Remove only the minimal branch that changes the cloned native expected value to two `false` fields. Compare the modern complete returned value to the unchanged native expected value, and add an exact negative graph/journal assertion for each minimal proof. The following is recommended test text, **not an executed changed test or a patch applied by this worker**:

```typescript
const expected = structuredClone(captured.nativeValue);
expect(resumed.value).toEqual(expected);

if (projection === "minimal") {
  expect(resumed.value.inputOutcomes[0].same).toBe(true);
  expect(resumed.value.trace[2][4]).toBe(true);
  const rejectedProof = resumed.proofs.find(
    (entry: Observation) => entry.proof.outcome.status === "rejected"
  );
  const recorded = captured.completed.replay.calls.find(
    (call: Observation) => call.id === rejectedProof.proof.callId
  );
  const expectedMinimalData = {
    root: { tag: "ref", id: 0 },
    nodes: [
      {
        kind: "object",
        nullPrototype: true,
        extensible: true,
        properties: {
          name: { value: "Error", configurable: true, enumerable: true, writable: true },
          message: {
            value: "right input unavailable",
            configurable: true,
            enumerable: true,
            writable: true
          }
        }
      }
    ]
  };
  expect(rejectedProof.modeledReasonIdentity).toBe(false);
  expect(rejectedProof.proof.outcome.reason).not.toBe(resumed.model.decodedReasonGraph.reason);
  expect(Object.getOwnPropertyNames(rejectedProof.proof.outcome.reason).sort()).toEqual([
    "message",
    "name"
  ]);
  expect(Object.hasOwn(rejectedProof.proof.outcome.reason, "stack")).toBe(false);
  expect(rejectedProof.encodedOutcome).toEqual(expectedMinimalData);
  expect(Object.hasOwn(rejectedProof.encodedOutcome.nodes[0], "errorType")).toBe(false);
  expect(Object.hasOwn(rejectedProof.encodedOutcome.nodes[0].properties, "stack")).toBe(false);
  expect(rejectedProof.encodedOutcome).not.toEqual(recorded.outcome.data);
  const expectedMinimalJournal = structuredClone(captured.completed.replay);
  expectedMinimalJournal.calls.find((call: Observation) => call.id === recorded.id).outcome.data =
    expectedMinimalData;
  expect(resumed.completed.replay).toEqual(expectedMinimalJournal);
  expect(resumed.completed.replay).not.toEqual(captured.completed.replay);
}
```

The cloned `expectedMinimalJournal` is a separate expected negative result, not a modified captured oracle, actual journal, or supplied proof. Its complete five-row equality assertion allows only the explicitly modeled minimal outcome; the original full Error oracle remains untouched and is required to differ. Keep the existing complete-proof exact encoded-outcome equality and whole-journal equality. Keep full stack/name/message expectations, decoded graph alias checks, proof/request bindings, zero callbacks, accepted outcome checks, five consumed calls, original initial-input graph, promise-settlement prefix, input/capture immutability, and fresh completed-replay exactness. Retain native-fields and generic raw qualification cases unchanged; their observed tag/stack/journal distinctions are documented above, not collapsed into the minimal case.

A two-boolean change by itself is **not** the recommended fix. The exact typed negative assertions are required to preserve the original information-loss contract. If a future run changes any additional journal field, synthesizes an Error tag/stack for the minimal projection, loses identity, reissues work during completed replay, or breaks complete proof equivalence, route that concrete result as a runtime regression instead of broadening this oracle.

## Native control procedure

The reviewed guest is a finite input-Promise/array/closure computation. It has no guest filesystem, network, LLM, dynamic imports, or provider calls. Only bounded host mock boundaries settle the two in-memory Promises. The host child reads V8 data from stdin and emits V8 data to stdout; unit tests do not write files. All durable evidence is authored with `apply_patch`, not by guest I/O.

The three independent native children execute the following command body with the exact source, selected profile, actual captured request, and either the real captured native Error or each exact minimal proof reason. No SafeJS module is imported by this native body. The original source is neither instrumented nor rewritten; only its existing default function is evaluated as in the frozen test.

<!-- O12 NATIVE CONTROL -->

<!-- prettier-ignore -->
```javascript
import { readFileSync } from 'node:fs';
import { serialize, deserialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const input = deserialize(readFileSync(0));
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(input.source) !== '8344978a75b367325409f07193a28977225c5c833a65e5a14537f2fd9b5cb005') throw Error('Changed source');
const record = input.capture.replay.calls.find(call => call.id === input.request.callId);
for (const key of ['runId', 'sourceHash', 'moduleId', 'operation', 'argumentDigest', 'lifecycle', 'policy', 'asynchronous']) if (record[key] !== input.request[key]) throw Error('Request mismatch: ' + key);
if (input.request.moduleId !== '<inputs>' || input.request.operation !== JSON.stringify(['bindings','incoming','remote'])) throw Error('Wrong request');
let acceptLeft, rejectRight;
const left = new Promise(resolve => { acceptLeft = resolve; });
const right = new Promise((resolve, reject) => { rejectRight = reject; });
void right.catch(() => undefined);
const fixture = { ...structuredClone(input.profile.fixtureData), primary: left, again: left, nested: { promise: left }, remoteMirror: right };
const incoming = { remote: right, again: right };
const calls = [], acknowledgements = [], hostTrace = [];
const boundary = async label => {
  calls.push(label); hostTrace.push(['call','boundary',label]);
  acknowledgements.push('boundary:' + label); hostTrace.push(['ack','boundary',label]);
  if (label === 'both-pending') { acknowledgements.push('input:right'); hostTrace.push(['ack','input','right','rejected']); rejectRight(input.reason); }
  if (label === 'after:right') { acknowledgements.push('input:left'); hostTrace.push(['ack','input','left','fulfilled']); acceptLeft(structuredClone(input.profile.receipts.left.value)); }
  return { boundary: label };
};
const nativeFunction = new Function('incoming','boundary','return ' + input.source.slice('export default '.length))(incoming,boundary);
const value = await nativeFunction(fixture);
const first = await right.catch(reason => reason);
const repeated = await right.catch(reason => reason);
if (first !== input.reason || repeated !== input.reason) throw Error('Native lost rejection identity');
if (!isDeepStrictEqual(value,input.profile.expected) || !isDeepStrictEqual(calls,input.profile.expectedCalls) || !isDeepStrictEqual(hostTrace,input.profile.expectedHostTrace) || !isDeepStrictEqual(acknowledgements,input.profile.expectedAcks)) throw Error('Complete native outcome mismatch');
process.stdout.write(serialize({ classification: 'NEW independent native same-source/same-request control', label: input.label, value, calls, hostTrace, acknowledgements, reason: input.reason, reasonOwnKeys: Object.getOwnPropertyNames(input.reason), actualError: input.reason instanceof Error, repeatedReasonSame: first === repeated, request: input.request, captureSha256: hash(serialize(input.capture)) }));
```

Exact child argv/stdin bytes, V8 output, hashes and exit statuses are in `evidence/supplemental-command-receipts.json`. The saved original child-command strings also reproduce the NEW public completed/context controls without creating a standalone QA script. Controls have a 10-second host deadline and 4 MiB output cap; the unchanged child has its original 3-second timer, 75,000-step/depth-80/data-3,000,000 budget, and the unchanged test has its original 5-second outer child deadline. TERM is unset; caches and HOME for execution are within the owned new clone.

## Evidence, preservation, and later gates

Owned evidence root: `out/safejs-o12-negative-adjudication/`. `evidence/full-outcomes.json` contains complete original expected/native/actual values, reference graphs, exact journals, same-capture/request anchors, and every comparison; V8 envelopes in command receipts are authoritative for native Error types and shared-object identity. `predecessor/` preserves Curie's manifest, H5 manifest, predecessor H8 manifest, old report/test bytes, exact context variant, and bounded source-contract evidence. No historical result is overwritten.

Dependency installation used `npm ci --ignore-scripts --no-audit --no-fund` with local cache and disabled skill sync/Husky; 548 packages installed. Host-only attempts are retained: persistent REPL `process` access failed once; its TypeScript import interop failed twice before any guest command, then exact template extraction succeeded in a separate ordinary Node process. These do not erase the two real H5 assertion failures. No optional new test, test-typecheck, lint result, full build rerun, or whole-root suite success is claimed; the existing standard bundle bytes are deliberately not rebuilt. Markdown formatting and final file/hash checks are recorded in the handoff.

Freeze only the report, unchanged evidence/test/package copies, complete command receipts/outcomes, preimages, and integrity records into the handoff. The sole authored publication candidate is this report; copied tests are evidence, not an authorized assertion revision. Current main production remains unchanged. Curie/root—not this worker—owns any later assertion update and publication decision. Nash's clean H5 projection, final PPR1/PPR2 refresh, final public source/standard-bundle gates, and final published all-stack execution remain pending outside this verdict.
