import {fs,path,scope,read,put,sha} from './io.mjs';
const retained=JSON.parse(read(path.join(scope,'RETAINED-SOURCES.json'),2097152));
for(const row of retained){const text=row.text??row.body;const lines=text.split('\n');const selected=lines.flatMap((line,index)=>/exports|Object\.keys\(api|exported|expectedNames|\.length, (80|[0-9]{3})|await run\(|await check\(|await test\(|^for |^const design|^const cases|^const names/.test(line)?[{line:index+1,text:lines.slice(Math.max(0,index-1),Math.min(lines.length,index+3)).join('\n')}]:[]);console.log(JSON.stringify({path:row.path,selected}));}
const base=path.dirname(scope);const workflows=read(path.join(base,'v4/workflows.mjs'),20000,{bytes:15763,sha256:'6d8a19854a6e96986013ed3d94ee15dd774e225259dea922bf4749799c60d89b'}).toString().split('\n');
for(const [start,end] of [[1,42],[90,215]])console.log(JSON.stringify({file:'workflows',start,text:workflows.slice(start-1,end).join('\n')}));
const seal=JSON.parse(read(path.join(base,'v4/PRESEAL.json'),16384));console.log(JSON.stringify({fixtureFiles:seal.fixtureFiles,planned:seal.planned,proposedActual:seal.proposedActual}));
const inherited=JSON.parse(read(path.join(scope,'inherited/BINDINGS.json'),1048576));console.log(JSON.stringify({stageABindings:inherited}));
const engine=JSON.parse(read(path.join(scope,'PUBLIC-ENGINE-RECEIPT.json'),131072));console.log(JSON.stringify({engineKeys:Object.keys(engine)}));
put('AUDIT-DETAIL-RESULT.json',{role:'SOURCE_ONLY',semanticRuns:0});
