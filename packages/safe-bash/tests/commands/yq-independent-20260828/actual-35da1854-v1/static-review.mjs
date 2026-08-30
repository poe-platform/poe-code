import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileRecord, json, owned, save } from './auth.mjs';

const plan = json(join(owned, 'preparation/SOURCE-STATIC-PLAN.json'));
const root = json(join(owned, 'ROOT-EXECUTION.json')).consumerSourceRoot;
const observations = [
  ['ENC-08', 'SUPPORT_ONLY', 'Malformed strings and keys are rejected by the async measure path before encoder/result admission; no private malformed-yield injection was executed.', [['structured/query-core.ts', 178, 236], ['yq/index.ts', 375, 394]]],
  ['ENC-09', 'SUPPORT_ONLY', 'The measure ancestor set detects a current-path cycle and removes ancestors on leave; no private cycle was injected.', [['structured/query-core.ts', 178, 236]]],
  ['ENC-10', 'SUPPORT_ONLY', 'Measure rejects unsupported primitive types and nonordinary object prototypes. Runtime graph injection remains unavailable.', [['structured/query-core.ts', 196, 233]]],
  ['QUE-09', 'SUPPORT_ONLY', 'compileAttempted is set before parse; subsequent compilation and run without AST refuse. No private session call was made.', [['structured/query-core.ts', 487, 501]]],
  ['QUE-10', 'SUPPORT_ONLY', 'Active iterator excludes overlap; close shares its promise and active return memo. Runtime concurrent private-session proof remains missing.', [['structured/query-core.ts', 494, 557]]],
  ['QUE-11', 'SUPPORT_ONLY', 'One session allocates one Budget, Interpreter and variables map, reused by the file/document loops. This is source identity evidence, not a runtime identity observer.', [['structured/query-core.ts', 466, 492], ['yq/index.ts', 330, 362]]],
  ['WRK-05', 'SUPPORT_ONLY', 'Each received chunk is admitted to invocation input bytes before owned Uint8Array copy; fallback file bytes are charged after provider return. Near-cap private projection and provider preemption are not established.', [['yq/index.ts', 208, 245], ['yq/index.ts', 248, 276], ['structured/query-core.ts', 159, 162]]],
  ['WRK-06', 'SOURCE_COUNTERPROOF', 'The frozen before-copy/before-decoded-append ordering is not implemented: the whole source is copied and decoded before beginDocument; rawLines also normalizes CRLF before computing rawBytes. This is static ordering/byte-accounting evidence, not an executed cap-boundary case.', [['yq/index.ts', 231, 244], ['yq/index.ts', 345, 351], ['yq/parser.ts', 855, 875], ['yq/parser.ts', 935, 938]]],
  ['WRK-07', 'SOURCE_COUNTERPROOF', 'Quoted scalar value construction runs before composer.scalar and its scalar-byte admission; decodeDouble appends characters before that gate. The near-cap four-byte escape projection was not executed.', [['yq/parser.ts', 264, 289], ['yq/parser.ts', 457, 474], ['yq/parser.ts', 528, 546]]],
  ['WRK-08', 'PARTIAL_SUPPORT', 'Compact scalar, mapping punctuation and alias descriptor accounting are present; query-yield measurement follows engine allocation. Entire allocation-preflight and exact inclusive-cap obligations remain unproved.', [['yq/parser.ts', 528, 566], ['yq/accounting.ts', 69, 81], ['yq/index.ts', 375, 394]]],
  ['WRK-11', 'SUPPORT_ONLY', 'One private Budget is reused and existing Budget.step rejects totals above maxSteps. No private near-limit state was manufactured.', [['structured/query-core.ts', 479, 484], ['structured/limits.ts', 45, 64], ['structured/query-core.ts', 135, 156]]],
  ['WRK-12', 'SUPPORT_ONLY', 'The command measures a yielded graph before admitResult and encoding; results are on the reused Budget. Exact 100000/100001 dynamic boundary is unavailable.', [['yq/index.ts', 373, 394], ['structured/query-core.ts', 169, 172]]],
  ['WRK-13', 'SOURCE_COUNTERPROOF', 'Flow sequence parses/allocates the prospective child before checking the parent member count. The pre-input-member-allocation obligation cannot be inferred from the later member guard; no large public probe was added.', [['yq/parser.ts', 394, 409], ['yq/parser.ts', 553, 565]]],
  ['WRK-15', 'SUPPORT_ONLY', 'Alias count survives beginDocument; invalid/unfinished targets refuse before copyAlias; projection and prepaid work precede clone allocation. 1024/1025 cross-document cap trace remains unrun.', [['yq/accounting.ts', 36, 81], ['yq/parser.ts', 582, 586], ['yq/accounting.ts', 207, 229]]],
  ['WRK-16', 'PARTIAL_SUPPORT', 'Alias node total is preflighted as a descriptor before copied containers are allocated. No 99998/99999 injected ledger trace was run; insertion-context depth is not established by descriptor-relative depth alone.', [['yq/accounting.ts', 69, 81], ['yq/accounting.ts', 150, 163], ['yq/accounting.ts', 207, 229]]],
  ['WRK-17', 'SOURCE_COUNTERPROOF', 'Final output allocation and submission are reserved before write, but quoted encoder fragment concatenation precedes append byte preflight. Thus every-retained-encoder-allocation preflight is not supported by source. No private output-counter boundary was injected.', [['yq/encoder.ts', 15, 35], ['yq/encoder.ts', 56, 79], ['yq/index.ts', 383, 411]]],
  ['WRK-18', 'SUPPORT_ONLY', 'Stdout/combined totals are monotone, and admitted operation bytes precede sink write with no refund path in the inspected flow. The exact reserved diagnostic boundary remains a private trace.', [['yq/accounting.ts', 83, 98], ['yq/index.ts', 309, 316], ['yq/index.ts', 400, 412]]],
  ['WRK-20', 'SUPPORT_ONLY', 'Diagnostic selection checks preferred then fixed fallback then emits nothing, with selected normal status returned. Exact private diagnostic-ledger edges are unrun.', [['yq/index.ts', 309, 316], ['yq/index.ts', 424, 434], ['yq/accounting.ts', 88, 98]]],
  ['WRK-21', 'SUPPORT_ONLY', 'Distinct payload-copy operations use ceil(bytes/1024); source uses separate reservation units. No internal operation observer was introduced.', [['yq/accounting.ts', 198, 204], ['yq/accounting.ts', 214, 243], ['yq/encoder.ts', 15, 30]]],
  ['WRK-23', 'PARTIAL_SUPPORT', 'Command and parser bound query source before synchronous tokenizer allocation; AST parsing retains source/tokens while compiling and uses depth gates. No compiler heap/latency measurement or separate query execution was performed.', [['yq/index.ts', 330, 338], ['structured/parser.ts', 33, 66], ['structured/parser.ts', 79, 117]]],
  ['WRK-24', 'PARTIAL_SUPPORT', 'Raw chunk copies plus aggregate bytes, decoded source/line records, input M, yielded Q, and encoder fragments/join/output may coexist. The declared M+Q+max(2E,3E+2s) is not a measured RSS or all-live-allocation bound; source README explicitly disclaims aggregate heap/CPU/preemption.', [['yq/index.ts', 218, 245], ['yq/index.ts', 345, 362], ['yq/encoder.ts', 6, 35], ['yq/index.ts', 387, 411], ['yq/README.md', 14, 19]]],
  ['WRK-26', 'SUPPORT_ONLY', 'Private count methods validate safe nonnegative counts and charge requires positive units; arithmetic overflow is guarded. Final CARRY vocabulary supersedes the old step probe. No public limit bridge or Budget injection is exposed by the command.', [['structured/query-core.ts', 69, 76], ['structured/query-core.ts', 135, 138], ['structured/query-core.ts', 339, 355], ['yq/index.ts', 462, 495]]],
  ['TYP-08', 'SUPPORT_ONLY', 'Private signatures retain Json/Ast/Interpreter/Budget/Decimal and borrowed signal. Factory options expose only replace. Source inspection is not a type-compile or private API conformance pass.', [['structured/query-core.ts', 1, 26], ['structured/query-core.ts', 47, 66], ['structured/query-core.ts', 479, 484], ['structured/query-core.ts', 560, 563], ['yq/index.ts', 462, 495]]],
];
assert.deepEqual(observations.map(([id]) => id).sort(), plan.ids.map((row) => row.id).sort());
const excerpts = new Map();
function references(ranges) {
  return ranges.map(([suffix, startLine, endLine]) => {
    const path = `src/commands/${suffix}`;
    const binding = plan.files.find((entry) => entry.path === path);
    assert(binding, path);
    assert.deepEqual(fileRecord(join(root, path)), { sha256: binding.sha256, bytes: binding.bytes, mode: binding.mode });
    const lines = readFileSync(join(root, path), 'utf8').split('\n');
    assert(startLine > 0 && endLine >= startLine && endLine <= lines.length);
    const key = `${path}:${startLine}-${endLine}`;
    excerpts.set(key, { ...binding, startLine, endLine, text: lines.slice(startLine - 1, endLine).join('\n') });
    return key;
  });
}
const results = observations.map(([id, classification, observation, ranges]) => ({ id, classification, observation, references: references(ranges), fullRecordPass: false, runtimePrivateCounterProof: false }));
const annotations = [
  { id: 'WRK-22', role: 'CRITICAL_CARRY_SOURCE_ANNOTATION_NOT_ADDITIONAL_CASE', observation: 'Pending count is invocation-scoped; reserve uses K=floor((c+U-1)/1023), U=0 retains c; finish assigns target pending and close has no terminal tick. Ordinary and prepaid paths check state around awaits. Static mechanics do not fulfill the original private observer.', references: references([['structured/query-core.ts', 135, 156], ['structured/query-core.ts', 339, 423]]) },
  { id: 'ENC-07', role: 'CRITICAL_ENCODER_SOURCE_ANNOTATION_NOT_ADDITIONAL_CASE', observation: 'Encoder traverses text by code point, with named/control escapes and surrogate validation; runtime results remain separately classified.', references: references([['yq/encoder.ts', 39, 79]]) },
];
save(join(owned, 'execution/SOURCE-STATIC.json'), { date: '2026-08-28', authority: 'preparation/SOURCE-STATIC-PLAN.json at preseal7d3423ed', designatedIds: 23, criticalOverlappingOriginalIds: annotations.map((row) => row.id), results, annotations, sourceCounterproofs: results.filter((row) => row.classification === 'SOURCE_COUNTERPROOF').map((row) => row.id), runtimeProbes: 0, semanticPasses: 0, fullRecordPasses: 0, noPrivateHookOrNewLimit: true });
save(join(owned, 'execution/SOURCE-EXCERPTS.json'), Object.fromEntries(excerpts));
console.log(JSON.stringify({ designatedIds: results.length, staticCounterproofs: results.filter((row) => row.classification === 'SOURCE_COUNTERPROOF').length, productImports: 0, privateRuntimeProofs: 0 }));
