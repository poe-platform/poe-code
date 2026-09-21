import {mkdirSync,copyFileSync,readFileSync,writeFileSync} from "node:fs";
const root=new URL("../",import.meta.url),dist=new URL("dist/",root),agents=new URL("agents/",dist);
mkdirSync(agents,{recursive:true});
for(const name of ["index.js","agents.js"])
 copyFileSync(new URL("../agent-defs-rust/dist/"+name,root),new URL(name,agents));
writeFileSync(new URL("native.js",agents),"export {native} from '../addon.js';\n");
writeFileSync(new URL("addon.js",dist),"import {createRequire} from 'node:module';export const native=createRequire(import.meta.url)('./agent-harness-tools-rust.node');\n");
for(const name of ["index.d.ts","types.d.ts","agents.d.ts"])copyFileSync(new URL("src/agents/"+name,root),new URL(name,agents));
copyFileSync(new URL("src/design.d.ts",root),new URL("design.d.ts",dist));

writeFileSync(new URL("agent-runtime.js",agents),readFileSync(new URL("../agent-defs-rust/dist/agent-runtime.js",root),"utf8").replaceAll("./agent-defs-rust.node","../agent-harness-tools-rust.node"));
