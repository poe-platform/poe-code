export { cases } from '../production-review/cohort.mjs';

export const files = {
  'alpha.txt': 'hit alpha\n',
  'beta.log': 'hit beta\n',
  'keep.tmp': 'hit keep\n',
  'skip.tmp': 'hit skip\n',
  'nested/gamma.txt': 'hit gamma\n',
  'nested/delta.log': 'hit delta\n',
  'ignored/drop.txt': 'hit drop\n',
  '.hidden.txt': 'hit hidden\n',
  '.ignore': '*.tmp\n!keep.tmp\nignored/\n',
};

export const globCases = [
  { id: 'include-extension', args: ['--no-ignore', '-g', '*.txt', 'hit', '.'], code: 0, output: './.hidden.txt:hit hidden\n./alpha.txt:hit alpha\n./ignored/drop.txt:hit drop\n./nested/gamma.txt:hit gamma\n' },
  { id: 'exclude-extension', args: ['--no-ignore', '-g', '!*.log', 'hit', '.'], code: 0, output: './alpha.txt:hit alpha\n./ignored/drop.txt:hit drop\n./keep.tmp:hit keep\n./nested/gamma.txt:hit gamma\n./skip.tmp:hit skip\n' },
  { id: 'ignore-negation-directory', args: ['hit', '.'], code: 0, output: './alpha.txt:hit alpha\n./beta.log:hit beta\n./keep.tmp:hit keep\n./nested/delta.log:hit delta\n./nested/gamma.txt:hit gamma\n' },
  { id: 'glob-last-rule', args: ['--no-ignore', '-g', '*.txt', '-g', '!nested/**', 'hit', '.'], code: 0, output: './.hidden.txt:hit hidden\n./alpha.txt:hit alpha\n./ignored/drop.txt:hit drop\n' },
  { id: 'glob-brace', args: ['--no-ignore', '-g', '*.{txt,log}', 'hit', '.'], code: 0, output: './.hidden.txt:hit hidden\n./alpha.txt:hit alpha\n./beta.log:hit beta\n./ignored/drop.txt:hit drop\n./nested/delta.log:hit delta\n./nested/gamma.txt:hit gamma\n' },
  { id: 'glob-malformed-class', args: ['-g', '[', 'hit', '.'], code: 2, output: '' },
  { id: 'glob-malformed-brace', args: ['-g', '{a,b', 'hit', '.'], code: 2, output: '' },
];
