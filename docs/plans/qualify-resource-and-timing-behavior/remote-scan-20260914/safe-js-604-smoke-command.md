# Installed safe-js 0.1.604 smoke command

Run in the independent consumer directory recorded in `installed-604-smokes.json`, after installing the exact package version. Execute this source with Node; assertions remain bounded and no wall-clock unit test is added.

```javascript
import assert from 'node:assert/strict';
import {run,Budget} from '@poe-platform/safe-js';
const rows=[];
for(const width of [5,6]) { const budget=new Budget({maxSteps:100}); let result;
try {const r=await run('return /z/.test(input);',{bindings:{input:'a'.repeat(width)},budget}); assert.equal(r.ok,true); assert.equal(r.returnValue,false); result={ok:r.ok};} catch(e){assert.equal(width,6);assert.equal(e.code,'budgetExceeded');assert.equal(e.current,101);result={error:{code:e.code,current:e.current,limit:e.limit}};}
assert.equal(budget.currentCallDepth,0);rows.push({width,...result,steps:budget.stepsUsed,depth:budget.currentCallDepth});}
const adjacent=new Budget({maxSteps:102}); const adjacentResult=await run('return /z/.test(input);',{bindings:{input:'a'.repeat(6)},budget:adjacent}); assert.equal(adjacentResult.ok,true); assert.equal(adjacentResult.returnValue,false); assert.equal(adjacent.stepsUsed,102);
const allowed=await run('return read();',{bindings:{read:()=>42}});assert.equal(allowed.ok,true);assert.equal(allowed.returnValue,42);
const denied=await run('return read();');assert.equal(denied.ok,false);
console.log(JSON.stringify({versions:process.versions,rows,authorityControls:true},null,2));
```
