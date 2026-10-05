import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RegexExecutor } from 'safe-bash-regex-engine/execution/portable';
import { createBoundedRegexProvider } from 'safe-bash-regex-engine/execution/bounded-provider';
import { Glob, matchGlobs } from './glob.js';

test('validated glob prefilter rejects impossible paths without rejecting engine matches', async () => {
  const session = new RegexExecutor(createBoundedRegexProvider()).open(new AbortController().signal);
  try {
    for (const source of ['node_modules/', '*.log', '/output/**/cache/', 'docs/*.md', '**/foo', 'a?c', '**foo*', '[ab]*', '{foo,bar}', 'foo\\*']) {
      const glob = new Glob(source);
      await matchGlobs([glob], [], session);
      for (const path of ['packages/src/index.ts', 'node_modules', 'a/node_modules', 'a.log', 'docs/a.md', 'output/a/cache', 'abc', 'foo', 'bar', 'é.txt']) {
        for (const directory of [false, true]) {
          const matched = await glob.matches(path, directory, session, false);
          if (matched) assert.equal(glob.mayMatch(path, directory), true, `${source}: ${path}`);
        }
      }
    }
    assert.equal(new Glob('node_modules/').mayMatch('packages/src', true), false);
    assert.equal(new Glob('*.log').mayMatch('packages/src/index.ts', false), false);
    assert.equal(new Glob('/output/**/cache/').mayMatch('packages/src', true), false);
    assert.equal(new Glob('*.log').mayMatch('café/index.ts', false), true);
    assert.equal(new Glob('*.log').mayMatch('bad\ud800/index.ts', false), true);
    assert.equal(new Glob('README*', true).mayMatch('readme.md', false), true);
  } finally { await session.close(); }
});

test('basename globs do not send irrelevant ancestor paths to the matcher', async (t) => {
  const session = new RegexExecutor(createBoundedRegexProvider()).open(new AbortController().signal);
  const run = t.mock.method(session, 'run');
  try {
    const globs = ['*.rs', 'unicode_categories.rs', 'target/', '/src/*.rs', '**foo*', '[a/]*', 'foo\\*'].map(source => new Glob(source));
    const path = 'packages/deep/source/lib.rs';
    assert.deepEqual(await matchGlobs(globs, globs.map(() => ({ path, directory: false, ancestors: false })), session), [true, false, false, false, false, false, false]);
    const rows = run.mock.calls[0]!.arguments[1];
    assert.deepEqual(rows.map(row => new TextDecoder('utf-16le').decode(row.bytes)), ['lib.rs', 'lib.rs', 'lib.rs', path, path, path, path]);
    assert.deepEqual(await matchGlobs([new Glob('source')], [{path, directory: false}], session), [true]);
    assert.equal(new TextDecoder('utf-16le').decode(run.mock.calls[1]!.arguments[1][0]!.bytes), path);
    const unicodePath = 'café/lib.rs';
    await matchGlobs([new Glob('*.rs')], [{path: unicodePath, directory: false, ancestors: false}], session);
    assert.equal(new TextDecoder('utf-16le').decode(run.mock.calls[2]!.arguments[1][0]!.bytes), unicodePath);
  } finally { await session.close(); }
});
