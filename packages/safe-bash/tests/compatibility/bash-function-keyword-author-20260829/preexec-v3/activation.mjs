const duration=1500000,maximumWindow=3000000;
function fields(value,keys){if(value===null||typeof value!=='object'||Array.isArray(value))throw Error('AUTH_SCHEMA');const own=Reflect.ownKeys(value);if(own.length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error('AUTH_SCHEMA');for(const key of own){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('AUTH_SCHEMA');}}
function time(value){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('AUTH_TIME_TYPE');return value;}
function exactNumbers(value,expected){fields(value,Object.keys(expected));for(const key of Object.keys(expected)){if(typeof value[key]!=='number'||!Number.isSafeInteger(value[key])||value[key]!==expected[key])throw Error('AUTH_LIMITS');}}
export function validateActivation(grant,review,{preseal,work,limits,roles,started,now}){
 fields(grant,['schema','decision','preseal','work','calls','issuedAtEpochMs','latestStartEpochMs','expiresEpochMs','limits','roles']);fields(review,['decision','preseal','scope','independentCommit']);
 time(grant.issuedAtEpochMs);time(grant.latestStartEpochMs);time(grant.expiresEpochMs);time(started);time(now);
 if(grant.schema!=='b35-runtime-grant-v3'||grant.decision!=='GO'||review.decision!=='ACCEPT'||grant.preseal!==preseal||review.preseal!==preseal||grant.work!==work||grant.calls!==54||review.scope!=='b35-preexec-v3'||typeof review.independentCommit!=='string'||!/^[a-f0-9]{40}$/.test(review.independentCommit))throw Error('AUTH_BINDING');
 exactNumbers(grant.limits,limits);exactNumbers(grant.roles,roles);
 if(limits.durationMs!==duration||grant.expiresEpochMs<duration||grant.latestStartEpochMs!==grant.expiresEpochMs-duration||grant.issuedAtEpochMs>grant.latestStartEpochMs||grant.expiresEpochMs-grant.issuedAtEpochMs>maximumWindow||started<grant.issuedAtEpochMs||now<started||now>grant.latestStartEpochMs)throw Error('AUTH_TIME_ORDER');
 return Object.freeze({finalDeadline:Math.min(started+duration,grant.expiresEpochMs),duration});
}
