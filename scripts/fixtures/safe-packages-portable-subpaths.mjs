import { createPandocCommands } from '@poe-platform/safe-bash/commands/pandoc';
import { createCsvkitCommands } from '@poe-platform/safe-bash/commands/csvkit';
import { createSsconvertCommands } from '@poe-platform/safe-bash/commands/ssconvert';
import { Shell, createSearchCommands } from '@poe-platform/safe-bash/search';
import { createMemoryFileSystem } from '@poe-platform/safe-fs/core';
import { createMetadataCommands } from '@poe-platform/safe-bash/commands/metadata';
import { createArchiveCommands } from '@poe-platform/safe-bash/commands/archive';
import { createTableTextCommands } from '@poe-platform/safe-bash/commands/table-text';
import { createStreamInspectionCommands } from '@poe-platform/safe-bash/commands/stream-inspection';
import { createStreamFormatCommands } from '@poe-platform/safe-bash/commands/stream-format';
import { createSplitCommands } from '@poe-platform/safe-bash/commands/split';
import { createTimeEnvCommands } from '@poe-platform/safe-bash/commands/time-env';
import { createTreeCommands } from '@poe-platform/safe-bash/commands/tree';
import { createFileCommands } from '@poe-platform/safe-bash/commands/file';
import { createGrepAliasCommands } from '@poe-platform/safe-bash/commands/grep-aliases';
import { createColumnCommands } from '@poe-platform/safe-bash/commands/column';
import { createHtmlToMarkdownCommands } from '@poe-platform/safe-bash/commands/html-to-markdown';
import { createDuCommands } from '@poe-platform/safe-bash/commands/du';
import { createExprCommands } from '@poe-platform/safe-bash/commands/expr';
import { createApplyPatchCommands } from '@poe-platform/safe-bash/commands/apply-patch';

export async function verifyPortableSubpaths() {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input', new TextEncoder().encode('héllo\n'));
  const shell = new Shell({ fs });
  for (const factory of [createSearchCommands, createMetadataCommands, createArchiveCommands,
    createTableTextCommands, createStreamInspectionCommands, createStreamFormatCommands,
    createSplitCommands, createTimeEnvCommands, createTreeCommands, createFileCommands,
    createGrepAliasCommands, createColumnCommands, createHtmlToMarkdownCommands,
    createDuCommands, createExprCommands, createApplyPatchCommands, createPandocCommands, createCsvkitCommands, createSsconvertCommands]) {
    for (const command of factory()) shell.commands.register(command);
  }
  try {
    await fs.writeFile('/table.csv', new TextEncoder().encode('name,value\nhéllo,2\n'));
    await fs.writeFile('/filter.lua', new TextEncoder().encode('function Str(el) el.text = string.upper(el.text); return el end'));
    for (const [source, stdin, expected] of [
      ['pandoc -f markdown -t html --lua-filter=/filter.lua', 'hello', '<p>HELLO</p>\n'],
      ['csvcut -c name /table.csv', '', 'name\nhéllo\n'],
      ['ssconvert /table.csv /table.xlsx; ssconvert /table.xlsx /roundtrip.csv', '', undefined],
      ['rg -F héllo /input', '', 'héllo\n'],
      ['stat -c %s /input', '', '7\n'],
      ['tar -cf /archive.tar -C / input; tar -xOf /archive.tar', '', 'héllo\n'],
      ['paste -d , /input /input', '', 'héllo,héllo\n'],
      ['nl', 'héllo\n', '     1\théllo\n'],
      ['seq 2', '', '1\n2\n'],
      ['split -l 1 /input /part; stat -c %s /partaa', '', '7\n'],
      ['date -u -d @0 +%Y', '', '1970\n'],
      ['tree /', '', undefined],
      ['file --mime-type /input', '', undefined],
      ['fgrep héllo /input', '', 'héllo\n'],
      ['column -t', 'héllo world\n', 'héllo  world\n'],
      ['html-to-markdown', '<p>héllo</p>', undefined],
      ['du -b /input', '', '7\t/input\n'],
      ['expr 2 + 3', '', '5\n'],
      ['apply_patch', '*** Begin Patch\n*** Add File: /patched\n+héllo\n*** End Patch\n', undefined],
    ]) {
      const result = await shell.exec(source, { stdin });
      if (result.exitCode !== 0 || (expected !== undefined && result.stdout !== expected)) {
        throw new Error(`${source}: ${JSON.stringify(result)}`);
      }
    }
    if (!new TextDecoder().decode(await fs.readFile('/roundtrip.csv')).includes('héllo')) throw new Error('Spreadsheet round trip failed');
    if (new TextDecoder().decode(await fs.readFile('/patched')) !== 'héllo\n') throw new Error('Patch bytes differ');
  } finally { await shell.dispose(); }
}
