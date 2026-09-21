import {mkdirSync,copyFileSync,readFileSync,writeFileSync,readdirSync} from "node:fs";
const root=new URL("../",import.meta.url),dist=new URL("dist/",root),agents=new URL("agents/",dist);
mkdirSync(agents,{recursive:true});
for(const name of ["index.js","agents.js"])
 copyFileSync(new URL("../agent-defs-rust/dist/"+name,root),new URL(name,agents));
writeFileSync(new URL("native.js",agents),"export {native} from '../addon.js';\n");
writeFileSync(new URL("addon.js",dist),"import {createRequire} from 'node:module';export const native=createRequire(import.meta.url)('./agent-harness-tools-rust.node');\n");
for(const name of ["index.d.ts","types.d.ts","agents.d.ts"])copyFileSync(new URL("src/agents/"+name,root),new URL(name,agents));
copyFileSync(new URL("src/design.d.ts",root),new URL("design.d.ts",dist));

writeFileSync(new URL("agent-runtime.js",agents),readFileSync(new URL("../agent-defs-rust/dist/agent-runtime.js",root),"utf8").replaceAll("./agent-defs-rust.node","../agent-harness-tools-rust.node"));

// Embed the owned task SDK hosts and declarations; one addon supplies native calls.
const tasks=new URL("tasks/",dist);
function embedTaskHosts(source,target){
 mkdirSync(target,{recursive:true});
 for(const entry of readdirSync(source,{withFileTypes:true})){
  const input=new URL(entry.name+(entry.isDirectory()?"/":""),source),output=new URL(entry.name+(entry.isDirectory()?"/":""),target);
  if(entry.isDirectory()){embedTaskHosts(input,output);continue;}
  if(entry.name.endsWith(".node"))continue;
  if(entry.name.endsWith(".js"))writeFileSync(output,readFileSync(input,"utf8").replaceAll("./task-list-rust.node","../agent-harness-tools-rust.node"));
  else copyFileSync(input,output);
 }
}
embedTaskHosts(new URL("../task-list-rust/dist/",root),tasks);

// Runtime interface types are self-contained even before runtime host integration.
function embedConfigTypes(source,target){
 mkdirSync(target,{recursive:true});
 for(const entry of readdirSync(source,{withFileTypes:true})){
  const input=new URL(entry.name+(entry.isDirectory()?"/":""),source),output=new URL(entry.name+(entry.isDirectory()?"/":""),target);
  if(entry.isDirectory())embedConfigTypes(input,output);
  else if(entry.name.endsWith(".d.ts"))copyFileSync(input,output);
 }
}
embedConfigTypes(new URL("../poe-code-config-rust/dist/",root),new URL("config/",dist));
copyFileSync(new URL("../task-list-rust/src/runner-types.d.ts",root),new URL("runner-types.d.ts",dist));
