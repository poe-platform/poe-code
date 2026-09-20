import {readdirSync,readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import ts from 'typescript';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root),definitions=new URL('definitions/',root);
mkdirSync(dist,{recursive:true});
let exports="import {allAgents} from './agent-runtime.js';\n",types="import type {AgentDefinition} from './types.js';\n";
for(const filename of readdirSync(definitions).filter(name=>name.endsWith('.json')).sort()){
 const {exportName,definition}=JSON.parse(readFileSync(new URL(filename,definitions),'utf8'));
 if(!ts.isIdentifierText(exportName,ts.ScriptTarget.Latest))throw Error('Invalid agent export name');
 exports+=`export const ${exportName}=allAgents.find(agent=>agent.id===${JSON.stringify(definition.id)});\n`;
 types+=`export declare const ${exportName}:AgentDefinition;\n`;
}
writeFileSync(new URL('agents.js',dist),exports);writeFileSync(new URL('agents.d.ts',dist),types);
for(const filename of ['index.d.ts','types.d.ts'])copyFileSync(new URL(`src/${filename}`,root),new URL(filename,dist));
