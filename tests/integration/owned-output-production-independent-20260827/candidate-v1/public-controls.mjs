import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../../..'), state = JSON.parse(readFileSync(JSON.parse(readFileSync('/tmp/owned-output-independent-current.json')).state));
const root = mkdtempSync(join(state.work, 'public-controls-')); const rows = [], hash = bytes => createHash('sha256').update(bytes).digest('hex');
cpSync(join(state.consumer, 'node_modules'), join(root, 'node_modules'), { recursive: true }); writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
const source = `import {createOutputOperation, type ByteSink, type CommandContext} from 'virtual-bash';
import {createOutputOperation as contracts} from 'virtual-bash/contracts';
import {createOutputOperation as subpath, type OutputOperation} from 'virtual-bash/contracts/output';
import type {HttpRequest} from 'virtual-bash/commands/network';
const context: Pick<CommandContext,'signal'|'registerCleanup'>={signal:new AbortController().signal};
const legacy:ByteSink={async write(bytes:Uint8Array){void bytes;}};
const request:HttpRequest={url:'http://local.invalid',method:'GET',headers:[],signal:context.signal};
const operation:OutputOperation=createOutputOperation(context,legacy); contracts(context,legacy);subpath(context,legacy);
operation.registerCleanup(async()=>{});operation.child(legacy);operation.output.write(new Uint8Array());
operation.acquire(()=>({value:1}),async resource=>{const value:number=resource.value;void value;});
void request;void operation.close();\n`;
const compiler = join(repo, 'node_modules/typescript/bin/tsc'), flags = [compiler, '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--typeRoots', join(repo, 'node_modules/@types')];
const negatives = {
  bytes: "operation.output.write('no');", signal: "const bad:ByteSink={write:async()=>{},ownedOutput:{consumerClosed:3,write:async()=>{}}};",
  capabilityWrite: "const bad:ByteSink={write:async()=>{},ownedOutput:{consumerClosed:context.signal}};", capabilitySignal: "const bad:ByteSink={write:async()=>{},ownedOutput:{write:async()=>{}}};",
  resource: "operation.acquire(()=>1,async(value:string)=>{});", cleanup: 'operation.registerCleanup(()=>3);', child: "operation.child({write:3});", readonly: 'operation.signal=context.signal;',
};
for (const [id, addition] of [['positive', ''], ...Object.entries(negatives)]) {
  const filename = join(root, id + '.mts'); writeFileSync(filename, source + addition);
  const result = spawnSync(state.node, [...flags, filename], { encoding: 'utf8', timeout: 30000 });
  writeFileSync(join(root, id + '.stdout'), result.stdout ?? ''); writeFileSync(join(root, id + '.stderr'), result.stderr ?? '');
  rows.push({ id, status: result.status, sourceSHA256: hash(source + addition), diagnostics: result.stdout });
  assert.equal(result.status, id === 'positive' ? 0 : 2);
  if (id !== 'positive') assert.match(result.stdout, new RegExp('error TS' + ({ bytes: 2345, signal: 2322, capabilityWrite: 2741, capabilitySignal: 2741, resource: 2322, cleanup: 2322, child: 2322, readonly: 2540 })[id] + ':', 'u'));
}
writeFileSync(join(root, 'identity.mjs'), "import assert from 'node:assert/strict'; import {createOutputOperation as root} from 'virtual-bash'; import {createOutputOperation as contracts} from 'virtual-bash/contracts'; import {createOutputOperation as leaf} from 'virtual-bash/contracts/output'; assert.equal(root,contracts);assert.equal(root,leaf);console.log('SAME_FACTORY');\n");
const identity = spawnSync(state.node, [join(root, 'identity.mjs')], { encoding: 'utf8', timeout: 10000 }); assert.equal(identity.status, 0); rows.push({ id: 'root-subpath-identity', status: identity.status, stdout: identity.stdout });
writeFileSync(join(root, 'REPORT.json'), JSON.stringify({ candidate: state.candidate, packageSHA256: state.packageSHA256, rows }, null, 2)); console.log('PUBLIC CONTROLS', root);
