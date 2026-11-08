import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {Shell} from '../../src/shell/index.js';
import {MemoryFileSystem} from '../../src/fs/memory/index.js';
import {csvkitCommands} from '../../src/commands/csvkit/index.js';
import {hexdumpCommands} from '../../src/commands/hexdump/index.js';
import {xanCommands} from '../../src/commands/xan/index.js';
import {xmllintCommands} from 'safe-bash-command-xmllint';

// Exercise defaults through actual shell argv and VFS, including command fast paths.
test('document and data commands work without injected codecs or runtimes', async () => {
  const fs = new MemoryFileSystem();
  const data = 'name,score\nalice,95\nbob,82\n';
  await fs.writeFile('/data.csv', new TextEncoder().encode(data));
  await fs.writeFile('/data.csv.gz', gzipSync(data));
  await fs.writeFile('/latin.csv', Uint8Array.from([110,97,109,101,10,99,97,102,233,10]));
  await fs.writeFile('/data.xml', new TextEncoder().encode('<root><item>one</item><item>two</item></root>'));
  await fs.writeFile('/bytes', new TextEncoder().encode('abcdef'));
  const shell = new Shell({fs}).use(csvkitCommands()).use(hexdumpCommands()).use(xanCommands()).use(xmllintCommands());
  try {
    for (const [command, expected] of [
      ['csvcut -e latin1 /latin.csv', 'name\ncafé\n'],
      ['csvcut -c name /data.csv.gz', 'name\nalice\nbob\n'],
      ['csvsql --query "SELECT name, score FROM data WHERE score > 85" /data.csv', 'name,score\nalice,95.0\n'],
      ['xmllint --xpath "count(/root/item)" /data.xml', '2\n'],
      [String.raw`hexdump -e '4/1 "%02x " "\n"' /bytes`, '61 62 63 64\n65 66      \n'],
      ['xan groupby score "count() as n" /data.csv', 'score,n\n95,1\n82,1\n'],
      ['xan enum /data.csv', 'index,name,score\n0,alice,95\n1,bob,82\n'],
    ]) {
      const result = await shell.exec(command!);
      assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
      assert.equal(result.stderr, '', command);
      assert.equal(result.stdout, expected, command);
    }
  } finally { await shell.dispose(); }
});
