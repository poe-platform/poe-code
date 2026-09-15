# Published work accounting witness

```sh
node --input-type=module <<'JS'
import {pathToFileURL} from 'node:url';
const {run,Budget}=await import(pathToFileURL("/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-published-resource-4wb676kb/package/dist/safe-js/index.js").href);
const records=[];
for (const width of [0,1,2,3,4,5,6,7,8]) {
 const budget=new Budget({maxSteps:100});let value,error;
 try {value=await run('return /z/.test(input)',{bindings:{input:'a'.repeat(width)},budget});}catch(failure){error={name:failure.name,code:failure.code,budget:failure.budget,current:failure.current,limit:failure.limit};}
 records.push({width,limit:100,result:value,error,steps:budget.stepsUsed,depth:budget.currentCallDepth,retained:[...budget.retainedValues()].length});
}
for (const input of ['aaaaaa','z']) {const budget=new Budget({maxSteps:102});const value=await run('return /z/.test(input)',{bindings:{input},budget});records.push({input,limit:102,result:value,steps:budget.stepsUsed});}
console.log(JSON.stringify({package:'@poe-platform/safe-js@0.1.603',versions:process.versions,records},null,2));
JS
```
