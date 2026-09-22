import assert from 'node:assert/strict';
import { extractRtf, tokenizeRtf, UnrtfError, unrtfBaseline } from '@poe-platform/safe-bash/commands/unrtf';
const limits = {inputBytes:10000, retainedBytes:10000, binaryBytes:10000, images:10, imageBytes:10000, tokenBytes:1024, tokens:10000, depth:100, decodedBytes:10000, outputBytes:10000, work:100000};
async function* input() {yield new TextEncoder().encode('{\\rtf1 A\\bin4 {}\\\u0000\\u945 ?}');}
let text = '';
for await (const event of extractRtf(input(),{limits,signal:new AbortController().signal})) if (event.kind === 'text') text += event.text;
assert.equal(text,'Aα');
assert.equal(unrtfBaseline.nativePersonalityCompatible,false);
assert.equal(typeof tokenizeRtf,'function');
await assert.rejects(async () => {for await (const event of extractRtf(input(),{limits,signal:new AbortController().signal,profile:'native-legacy'})) void event;}, e => e instanceof UnrtfError && e.code === 'E_PROFILE');
console.log('Installed unrtf byte-stream engine passed');
const { renderRtf, unrtfCommands, createUnrtfCommand } = await import('@poe-platform/safe-bash/commands/unrtf');
async function* styledInput() { yield new TextEncoder().encode('{\\rtf1 <{\\b B}>}'); }
let html = '';
for await (const bytes of renderRtf(styledInput(),{format:'html',limits,signal:new AbortController().signal})) html += new TextDecoder().decode(bytes);
assert.equal(html,'<!DOCTYPE html><html><body><p>&lt;<strong>B</strong>&gt;</p></body></html>');
assert.equal(createUnrtfCommand().name,'unrtf');
assert.equal(unrtfCommands().name,'unrtf');
const root = await import('@poe-platform/safe-bash');
const contracts = await import('@poe-platform/safe-bash/contracts');
assert.equal(createUnrtfCommand().runtimeIdentity,contracts.commandRuntimeIdentity);
const fs = root.createMemoryFileSystem();
await fs.writeFile('/document.rtf',new TextEncoder().encode('{\\rtf1 A\\tab B\\par C{\\object BAD}}'));
const shell = new root.Shell({fs});
try {
  assert.equal((await shell.exec('unrtf --text /document')).exitCode,127);
  shell.use(unrtfCommands());
  const cli = await shell.exec('unrtf --text /document');
  assert.deepEqual(cli,{exitCode:0,stdout:'A\tB\nC',stderr:'',stdoutBytes:new TextEncoder().encode('A\tB\nC'),stderrBytes:new Uint8Array()});
  const {unrtf} = await import('@poe-platform/safe-bash/commands/unrtf');
  shell.use({name:'unrtf-sdk-fixture',setup(host) { host.commands.register({name:'sdk-unrtf',runtimeIdentity:contracts.commandRuntimeIdentity,execute(context) { return unrtf(context,{format:'text',file:'/document'}); }}); }});
  assert.deepEqual(await shell.exec('sdk-unrtf'),cli);
  await fs.writeFile('/--text',new TextEncoder().encode('{\\rtf1 literal}'));
  assert.equal((await shell.exec('unrtf --text -- /--text')).stdout,'literal');
  assert.equal((await shell.exec('unrtf --latex /document')).exitCode,1);
} finally { await shell.dispose(); }
console.log('Installed unrtf command identity and CLI/SDK parity passed');
