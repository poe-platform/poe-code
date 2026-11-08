import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const scope=import.meta.dirname,base=path.dirname(scope),sha=body=>crypto.createHash('sha256').update(body).digest('hex');
const stage=JSON.parse(fs.readFileSync(path.join(scope,'stageAProducerPreseal.json')));console.log(JSON.stringify({inputs:stage.inputs,source:stage.source,tools:stage.tools,links:stage.links,bounds:stage.bounds},null,2));
const retained=JSON.parse(fs.readFileSync(path.join(base,'stage-b/RETAINED-SOURCES.json')));for(const row of retained.filter(row=>/\/(resources|loader)\.mjs$/.test(row.path))){assert.equal(sha(Buffer.from(row.text??row.body)),row.sha256);console.log(row.path+'\n'+(row.text??row.body));}
const text=fs.readFileSync(path.join(base,'v4/workflows.mjs'),'utf8');assert.equal(sha(Buffer.from(text)),'6d8a19854a6e96986013ed3d94ee15dd774e225259dea922bf4749799c60d89b');console.log(text.split('\n').slice(49,67).join('\n'));
