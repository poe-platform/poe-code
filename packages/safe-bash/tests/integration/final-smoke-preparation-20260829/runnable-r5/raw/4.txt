import assert from 'node:assert/strict';
export const limits=Object.freeze({knownOS:40,peak:3,inclusiveMs:1200000,publicationMs:180000,layoutMs:120000,retirementMs:30000,installMs:120000,captureBytes:67108864,workBytes:536870912,reservationBytes:330506183,loaders:3,guestWorkers:0,regexWorkers:0});
export function activationTimes(started,now=started){
  assert(Number.isSafeInteger(started)&&Number.isSafeInteger(now)&&now>=started);
  assert(started<=Date.parse('2026-08-29T17:55:00.000Z'),'latest activation');
  const deadline=started+limits.inclusiveMs;
  assert(deadline<=Date.parse('2026-08-29T18:15:00.000Z'),'absolute expiry');
  assert(now<deadline-limits.publicationMs,'active phase expired');
  return {started,activeEnd:deadline-limits.publicationMs,deadline};
}
export function validateGrant(value,digest){
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  const keys=['schema','action','packetSha256','authorization','producerReview','preexecReview'];
  assert.deepEqual(Reflect.ownKeys(value).sort(),keys.sort());
  for(const key of keys)assert(Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
  assert.equal(value.schema,'FINAL_SMOKE_FIXED_ACTIVATION_R4');assert.equal(value.action,'ROOT_FINAL_COHERENT_SMOKE24');assert.equal(value.packetSha256,digest);
  assert(typeof value.authorization==='string'&&value.authorization.length>0&&value.authorization!=='PENDING');
  for(const key of ['producerReview','preexecReview'])assert.match(value[key],/^[a-f0-9]{40}$/);
}
