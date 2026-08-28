import assert from 'node:assert/strict';
let rejection;
try { await import(process.env.NEGATIVE_TARGET); } catch (error) { rejection = error; }
assert.ok(rejection, 'FORBIDDEN_IMPORT_SUCCEEDED');
assert.equal(rejection.code, process.env.NEGATIVE_CODE);
if (process.env.NEGATIVE_MESSAGE) assert.ok(rejection.message.includes(process.env.NEGATIVE_MESSAGE));
console.log(JSON.stringify({ classification: 'intentional-import-negative', target: process.env.NEGATIVE_TARGET, code: rejection.code, message: rejection.message, productAcceptance: false }));
