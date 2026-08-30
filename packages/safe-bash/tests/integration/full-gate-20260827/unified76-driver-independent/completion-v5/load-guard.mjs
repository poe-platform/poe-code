import assert from 'node:assert/strict';
import {readFileSync,realpathSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
const expected=JSON.parse(readFileSync(process.env.REVIEW_MODULES));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checked=new Set();
const check=url=>{
  if(url.startsWith('node:'))return;
  assert.ok(url.startsWith('file:'));
  const path=realpathSync(fileURLToPath(url));
  assert.ok(Object.hasOwn(expected,path),'Unbound module origin: '+path);
  assert.ok(!/\/(execute|public|worker)\.mjs$/u.test(path),'Gate execution module is forbidden');
  assert.equal(sha(readFileSync(path)),expected[path],path);
  if(!checked.has(path)){checked.add(path);appendFileSync(process.env.REVIEW_IMPORT_LOG,JSON.stringify({path,sha256:expected[path]})+'\n');}
};
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);check(result.url);return result;},load(url,context,next){check(url);return next(url,context);}});
