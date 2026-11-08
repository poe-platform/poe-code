import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell, MemoryFileSystem, CommandRegistry } from 'virtual-bash';

test('D03 corrected same-value forwarding and both existing conditional restoration branches', async () => {
  const examples = [
    { overlay: '1', source: 'getopts ab opt -ab; getopts ab opt -ab; getopts ab opt -ab; say "$opt:$OPTIND"', expected: '?:2\n' },
    { overlay: '0', source: 'getopts ab opt -ab; getopts ab opt -ab; getopts ab opt -ab; say "$opt:$OPTIND"', expected: 'b:2\n' },
    { overlay: '1', source: 'getopts abcd opt -a -b; export OPTIND; getopts abcd opt -abc; say "$OPTIND"; getopts abcd opt -acd -b; say "$opt:$OPTIND"', expected: '2\nb:3\n' },
  ];
  for (const example of examples) {
    const commands = new CommandRegistry([{ name: 'say', async execute(context) { await context.stdout.write(Buffer.from(context.args.join(' ') + '\n')); return { exitCode: 0 }; } }]);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands });
    let count = 0;
    shell.use(async (context, next) => { if (context.command === 'getopts' && ++count === 2) context.env.OPTIND = example.overlay; return next(); });
    const result = await shell.exec(example.source);
    assert.equal(result.stdout, example.expected);
    assert.equal(result.stderr, '');
    await shell.dispose();
  }
});
