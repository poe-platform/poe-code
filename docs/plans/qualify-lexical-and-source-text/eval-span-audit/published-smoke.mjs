import assert from 'node:assert/strict';
const [mode,entry]=process.argv.slice(2);
const api=await import(entry);
if(mode==='js'){
 for(const separator of ['\n','\r','\r\n','\u2028','\u2029']){
  const prefix='// 😀'+separator;const text=prefix+'const x=)';
  for(const call of ['eval','(0,eval)'])await assert.rejects(api.run('return '+call+'('+JSON.stringify(text)+')',{filename:'guest/main.ajs'}),e=>e.name==='SyntaxError'&&e.filename==='<eval>'&&e.span.start.line===2&&e.span.start.column===9&&e.span.start.offset===prefix.length+8&&e.excerpt.includes('2 | const x=)'));
  await assert.rejects(api.run('/['+separator+']/'));
 }
 if(process.argv.includes('--lint-origin')){
  await assert.rejects(api.run('/a\r\n/',{budget:new api.Budget({stringLength:2})}),{name:'SandboxError',code:'budgetExceeded',budget:'stringLength',current:3,limit:2});
  await api.run('/a/',{budget:new api.Budget({stringLength:2})});
  for(const line of ['\n','\r','\r\n','\u2028','\u2029']){
   const source='// 😀'+line+'/['+line+']/';
   for(const fix of [false,true])assert.throws(()=>api.lint(source,{filename:'guest.ajs',fix}),e=>e.name==='ParseError'&&e.filename==='guest.ajs'&&e.line===2&&e.column===3&&e.stack===`ParseError: ${e.message}`);
  }
 }
 assert.deepEqual((await api.run('var x;do break;while(0)x=42;let y=8;y/=2;return [x,y,/=/.test("=")]')).returnValue,[42,4,true]);
 assert.deepEqual((await api.run('return (s=>[s.raw[0],s[0]])`\\xZ`')).returnValue,['\\xZ',undefined]);
 assert.deepEqual((await api.run('return [typeof process,typeof require,typeof fetch]')).returnValue,['undefined','undefined','undefined']);
 const source='('.repeat(1024)+'1'+')'.repeat(1024);
 await assert.rejects(api.run(source,{filename:'guest.ajs'}),e=>e.filename==='guest.ajs'&&e.stack===`${e.name}: ${e.message}`);
 assert.equal((await api.run('return (((1+2)))')).returnValue,3);
}else if(mode==='fs'){
 const fs=api.createMemoryFileSystem();await fs.writeFile('/lexical.txt',new TextEncoder().encode('verified'));
 assert.equal(new TextDecoder().decode(await fs.readFile('/lexical.txt')),'verified');
}else if(mode==='bash'){
 const fs=new api.MemoryFileSystem();const shell=new api.Shell({fs}).use(api.agentCommands());
 try{const result=await shell.exec('printf lexical');assert.equal(result.exitCode,0);assert.equal(result.stdout,'lexical');}finally{await shell.dispose();}
}else throw new Error('Unknown smoke mode');
console.log(JSON.stringify({entry,mode,status:'passed',node:process.version,icu:process.versions.icu}));
