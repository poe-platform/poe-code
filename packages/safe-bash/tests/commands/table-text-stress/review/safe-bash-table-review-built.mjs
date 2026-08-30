import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Shell,createMemoryFileSystem,agentCommands,createAgentCommands,createTableTextCommands} from 'virtual-bash';
import {createTableTextCommands as fromSubpath} from 'virtual-bash/commands/table-text';

assert.equal(fromSubpath,createTableTextCommands);
assert.deepEqual(createTableTextCommands().map(command=>command.name),['paste','comm','join']);
const names=createAgentCommands().map(command=>command.name);
assert.equal(names.length,56);
assert.equal(new Set(names).size,56);
assert.equal(names.filter(name=>name==='cut').length,1);
assert.ok(!names.includes('curl'));
assert.ok(!names.includes('safejs'));
const metadata=JSON.parse(await readFile(new URL('package.json',import.meta.url),'utf8'));
assert.equal(Object.keys(metadata.dependencies??{}).length,0);
const corpus=JSON.parse(await readFile(new URL('tests/commands/table-text-stress/frozen-corpus.json',import.meta.url),'utf8'));
assert.equal(corpus.length,71);
const results=[];
for (const mode of ['pipeline','redirection']) {
  let matches=0,knownDifferences=0;
  for (const {fixture,oracle} of corpus) {
    const fs=createMemoryFileSystem();
    await fs.mkdir('/work');
    for (const [name,hex] of Object.entries(fixture.files)) await fs.writeFile(`/work/${name}`,Buffer.from(hex,'hex'));
    await fs.writeFile('/work/input',Buffer.from(fixture.stdinHex,'hex'));
    const shell=new Shell({fs,cwd:'/work',env:{LC_ALL:'C'}}).use(agentCommands());
    try {
      const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
      const invocation=[fixture.command,...fixture.args].map(quote).join(' ');
      const actual=await shell.exec(mode==='pipeline'?`cat input | ${invocation}`:`${invocation} < input`,{signal:AbortSignal.timeout(5000)});
      assert.equal(Buffer.from(actual.stdoutBytes).toString('hex'),oracle.stdoutHex,`${mode}: ${fixture.name}`);
      for (const [name,hex] of Object.entries(fixture.files)) assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString('hex'),hex);
      assert.equal(Buffer.from(await fs.readFile('/work/input')).toString('hex'),fixture.stdinHex);
      assert.deepEqual((await fs.readdir('/work')).map(entry=>entry.name).sort(),[...Object.keys(fixture.files),'input'].sort());
      if (fixture.name==='comm shared original') {
        assert.equal(oracle.exitCode,1); assert.equal(actual.exitCode,0); assert.equal(actual.stderr,''); knownDifferences++;
      } else {
        assert.equal(actual.exitCode,oracle.exitCode,`${mode}: ${fixture.name}`);
        assert.equal(Boolean(actual.stderr),Boolean(oracle.stderrHex),`${mode}: ${fixture.name}`); matches++;
      }
    } finally {await shell.dispose();}
  }
  results.push({mode,fixtures:corpus.length,nativeMatches:matches,knownDifferences});
}
console.log(JSON.stringify({publicExportsAndRegistration:'pass',results,limitation:'Reviewer replay of existing frozen inputs, not the unavailable original six built-check script.'},null,2));
