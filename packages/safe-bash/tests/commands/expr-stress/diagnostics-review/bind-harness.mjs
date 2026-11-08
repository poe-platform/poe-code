import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addEvidence, git, owned, sha256 } from './replay/review.mjs';
const origin='50b1e560:tests/commands/expr-stress/extension-review/after-abort-fix/replay';
const files=['stage.mjs','runtime-driver.mjs','watchdog.mjs','protocol-driver.mjs','lifecycle-driver.mjs','extra-driver.mjs','shell-lifecycle-driver.mjs','accept-native.mjs','accept-controls.mjs','distribution.mjs','supplement.mjs','comparators.mjs'];
const replacements=[['candidate-27a77935','candidate-diagnostics'],['distribution-27a77935','distribution-diagnostics'],['supplement-27a77935','supplement-diagnostics']];
const bindings=[];
for(const file of files) {
  const original=git('show',`${origin}/${file}`).toString();
  let bound=original;
  const deltas=[];
  for(const [from,to] of replacements) if(bound.includes(from)) {bound=bound.replaceAll(from,to); deltas.push({from,to});}
  if(file==='stage.mjs') {const from='/tmp/expr-cancel-fix-candidate.txt',to='tests/commands/expr-stress/diagnostics-review/freeze/baseline-source.txt';assert(bound.includes(from));bound=bound.replaceAll(from,to);deltas.push({from,to});}
  addEvidence(`${owned}/${file}`,bound);
  bindings.push({file,origin:`${origin}/${file}`,originalSha256:sha256(original),boundSha256:sha256(readFileSync(`${owned}/${file}`)),deltas});
}
addEvidence(`${owned}/harness-bindings.json`,{candidateInspected:false,bindings});
