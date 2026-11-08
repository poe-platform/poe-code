import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.env.REVIEW_PACKAGE;
const load = path => import(pathToFileURL(root + '/dist/' + path + '.js').href);
const { createHtmlToMarkdownCommand } = await load('commands/html-to-markdown/index');
const { Budget } = await load('commands/html-to-markdown/budget');
const { settings } = await load('commands/html-to-markdown/options');
const { destination, entities } = await load('commands/html-to-markdown/entities');
const { normalizeText, trimText } = await load('commands/html-to-markdown/text');
const { toByteSource } = await load('contracts/index');
const { MemoryFileSystem } = await load('fs/memory/index');
const test = JSON.parse(readFileSync(process.argv[2]));
let actual;
async function convert(input) {
  const stdout = [], stderr = [];
  const result = await createHtmlToMarkdownCommand().execute({ command: 'html-to-markdown', args: [], cwd: '/', env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal, stdin: toByteSource(input), stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}
try {
  if (test.action === 'edges') {
    const observations = [];
    for (const scalar of [...Array.from({ length: 32 }, (_, index) => index), ...Array.from({ length: 33 }, (_, index) => 127 + index)]) for (const side of ['before', 'after']) {
      const url = 'https://safe.test/path', character = String.fromCodePoint(scalar);
      const budget = new Budget({ signal: new AbortController().signal }, settings({}));
      const result = await destination(side === 'before' ? character + url : url + character, false, budget);
      observations.push({ scalar, side, allowed: result !== undefined }); assert.equal(result, undefined);
      if (scalar !== 0) {
        const reference = '&#' + scalar + ';';
        const value = side === 'before' ? reference + url : url + reference;
        for (const image of [false, true]) {
          const output = await convert(image ? `<img src="${value}" alt="label">` : `<a href="${value}">label</a>`);
          observations.push({ scalar, side, image, ...output }); assert.deepEqual(output, { exitCode: 0, stdout: 'label\n', stderr: '' });
        }
      }
    }
    for (const [input, stdout] of [['<a href=" https://safe.test/path ">label</a>', '[label](<https://safe.test/path>)\n'], ['<img src=" https://safe.test/path " alt="label">', '![label](<https://safe.test/path>)\n'], ['<a href="&#0;https://safe.test">label</a>', 'label\n']]) {
      const output = await convert(input); observations.push({ input, ...output }); assert.deepEqual(output, { exitCode: 0, stdout, stderr: '' });
    }
    actual = { observations };
  } else if (test.action === 'scan-abort') {
    const controller = new AbortController(), reason = Object.freeze({ id: test.id }), budget = new Budget({ signal: controller.signal }, settings({}));
    const original = budget.checkpoint.bind(budget); const events = []; let queued = false, settled = false, triggerAt, caught;
    budget.checkpoint = function () {
      if (!queued && budget.workUsed > 0 && budget.sinceYield >= 4096) {
        queued = true; events.push({ event: 'charged-checkpoint', work: budget.workUsed, aborted: controller.signal.aborted });
        setImmediate(() => { triggerAt = performance.now(); events.push({ event: 'trigger', settled, work: budget.workUsed }); controller.abort(reason); });
      }
      return original();
    };
    const operations = { trim: () => trimText(' '.repeat(131072), budget), normalize: () => normalizeText('a '.repeat(65536), budget, 'space'), destination: () => destination('https://safe.test/' + '&#'.repeat(65536), false, budget), entities: () => entities('&'.repeat(131072), budget) };
    try { await operations[test.operation](); } catch (error) { caught = error; } finally { settled = true; }
    actual = { events, reasonIdentity: caught === reason, settlementMs: performance.now() - triggerAt, work: budget.workUsed };
    assert.equal(caught, reason); assert(queued); assert.equal(events[1].settled, false); assert(actual.settlementMs < 1000);
  } else actual = await convert(test.input);
  console.log(JSON.stringify({ id: test.id, outcome: 'PASS', actual }));
} catch (error) { console.log(JSON.stringify({ id: test.id, outcome: 'FAIL', actual, error: error.stack })); process.exitCode = 1; }
