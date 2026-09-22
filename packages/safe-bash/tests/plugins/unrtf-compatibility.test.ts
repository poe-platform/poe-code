import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell, agentCommands, createMemoryFileSystem } from '../../src/index.js';
import { unrtf, unrtfCommands } from '../../src/commands/unrtf/index.js';
import { fmtCommands } from '../../src/commands/fmt/index.js';

const encoder = new TextEncoder();
test('independent RTF extraction composes with rg and fmt through VFS CLI and SDK', async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({fs}).use(agentCommands()).use(unrtfCommands()).use(fmtCommands({replace:true}));
  t.after(() => shell.dispose());
  await fs.writeFile('/document.rtf', encoder.encode('{\\rtf1 alpha beta gamma\\par other line\\par alpha delta\\par}'));
  shell.use({name:'unrtf-sdk-compatibility',setup(host) {
    host.commands.register({name:'sdk-unrtf',execute(context) { return unrtf(context,{format:'text',file:'/document.rtf'}); }});
  }});
  for (const source of ['unrtf --text /document.rtf','sdk-unrtf']) {
    const selected = await shell.exec(source+' | rg -F alpha');
    assert.equal(selected.exitCode,0,selected.stderr);
    assert.equal(selected.stderr,'');
    assert.equal(selected.stdout,'alpha beta gamma\nalpha delta\n');
    const wrapped = await shell.exec(source+' | fmt -w 12');
    assert.equal(wrapped.exitCode,0);
    assert.equal(wrapped.stderr,'');
    assert.equal(wrapped.stdout,'alpha beta\ngamma other\nline alpha\ndelta\n');
    const chain = await shell.exec(source+' | rg -F alpha | fmt -w 12');
    assert.equal(chain.exitCode,0);
    assert.equal(chain.stderr,'');
    assert.equal(chain.stdout,'alpha beta\ngamma alpha\ndelta\n');
  }
  assert.deepEqual(await fs.readFile('/document.rtf'),encoder.encode('{\\rtf1 alpha beta gamma\\par other line\\par alpha delta\\par}'));
});
