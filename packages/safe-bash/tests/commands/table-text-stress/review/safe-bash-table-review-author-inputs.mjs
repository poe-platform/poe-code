import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {root,work,save,sha,drift} from './safe-bash-table-review-tools.mjs';
const historical='/tmp/safe-bash-table-author-frozen.WutzVL';
const paths=readdirSync(`${root}/tests/commands/table-text`).map(name=>`tests/commands/table-text/${name}`);
paths.push('tests/plugins/agent-commands.test.ts','tests/integration/adapter-tools-diagnostics/eight-cases.test.ts','tests/commands/structured-stress/split-increment/interop.test.ts','tests/commands/structured-stress/final-increment/fresh-interop.test.ts');
const current=Object.fromEntries(paths.map(path=>[path,sha(readFileSync(`${root}/${path}`))]));
const before=Object.fromEntries(paths.map(path=>[path,existsSync(`${historical}/${path}`)?sha(readFileSync(`${historical}/${path}`)):null]));
save(`${work}/author-input-comparison.json`,{historical,current,before,drift:drift(before,current),limitation:'These are exact author cohort entrypoints and table fixtures/helpers, not an assertion that current whole-product source matches the historical snapshot.'});
console.log(JSON.stringify({drift:drift(before,current),files:paths.length}));
