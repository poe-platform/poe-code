import {fs,path,assert,scope,prior,read,sha,json} from './common.mjs';
const sealed=JSON.parse(read(path.join(scope,'../v4/PRESEAL.json'),1048576,{bytes:8922,sha256:'4911f32f621e33adf8cacd0eabbc13b0644586fc3efd36ca42abf3c85765734c'}));
const row=sealed.fixtureFiles.find(item=>item.path.endsWith('/v2/TOOLS.json'));assert.ok(row);
const raw=read(path.join(prior,'TOOLS.json'),1048576,row),tools=JSON.parse(raw);
const links=[];
for(const [name,pack] of Object.entries(tools.packages))for(const item of pack.rows)if(item.type!=='file')links.push({package:name,root:pack.resolvedRoot,...item});
const result={toolManifestSha256:sha(raw),links,productExecutions:0};json(path.join(scope,'PINNED-LINKS.json'),result);console.log(JSON.stringify(result));
