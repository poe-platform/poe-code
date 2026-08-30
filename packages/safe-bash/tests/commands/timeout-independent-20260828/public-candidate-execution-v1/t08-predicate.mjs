import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertTypeOutcome as original } from '../public-integration-freeze-v1/predicates.mjs';
export const exactMessage='Object literal may only specify known properties, but \'invoker\' does not exist in type \'Omit<TimeoutCommandsOptions, "replace">\'. Did you mean to write \'invoke\'?';
export function assertTypeOutcome(receipt,spec){
  if(spec.id!=='T08')return original(receipt,spec);
  assert.equal(createHash('sha256').update(spec.source).digest('hex'),'25f880b655320604bd560478047eb792cfb7912d26b79702ad9987263d36059b','T08_PAYLOAD_UNCHANGED');
  assert.equal(spec.code,2353,'ORIGINAL_T08_EXPECTATION_RETAINED');assert.equal(spec.entrypoint,'root');assert.equal(spec.property,'invoker');
  assert.deepEqual(receipt.diagnostics,[{file:'consumer.ts',line:2,column:52,code:2561,token:'invoker',message:exactMessage}],'EXACT_T08_DIAGNOSTIC');
  return original(receipt,{...spec,code:2561});
}
