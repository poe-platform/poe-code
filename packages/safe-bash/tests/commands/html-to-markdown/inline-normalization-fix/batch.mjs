import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.env.REVIEW_PACKAGE;
const load = path => import(pathToFileURL(root + '/dist/' + path + '.js'));
const { createHtmlToMarkdownCommand } = await load('commands/html-to-markdown/index');
const { MemoryFileSystem } = await load('fs/memory/index');
const { toByteSource } = await load('contracts/index');
const rows = [];
for (const entry of JSON.parse(readFileSync(process.argv[2]))) {
  const stdout = [], stderr = [], cleanups = [];
  let error, result;
  try {
    result = await createHtmlToMarkdownCommand().execute({
      command: 'html-to-markdown', args: [], cwd: '/', env: {},
      fs: new MemoryFileSystem(), signal: new AbortController().signal,
      stdin: toByteSource(entry.input ?? entry.html),
      stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
      registerCleanup: cleanup => cleanups.push(cleanup),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.concat(stderr).toString(), '');
    if (entry.markdown !== undefined) assert.equal(Buffer.concat(stdout).toString(), entry.markdown);
  } catch (failure) { error = failure.stack; }
  finally { for (const cleanup of cleanups) await cleanup(); }
  rows.push({ id: entry.id, exitCode: result?.exitCode, markdown: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), cleanupCount: cleanups.length, outcome: error ? 'FAIL' : 'PASS', error });
}
console.log(JSON.stringify({ rows }));
