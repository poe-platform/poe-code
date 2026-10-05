import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RegexExecutor } from 'safe-bash-regex-engine/execution/portable';
import { createBoundedRegexProvider } from 'safe-bash-regex-engine/execution/bounded-provider';
import { Glob, matchGlobs } from './glob.js';

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
