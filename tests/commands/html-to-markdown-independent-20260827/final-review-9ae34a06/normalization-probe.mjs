import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const load = path => import(pathToFileURL(process.env.REVIEW_PACKAGE + '/dist/commands/html-to-markdown/' + path + '.js'));
const { Budget } = await load('budget');
const { settings } = await load('options');
const { Parser } = await load('parser');
const { Renderer } = await load('render');
const mode = process.argv[2];
let actual;
try {
  const observations = [];
  for (const count of mode === 'scale' ? [256, 1024, 4096] : [4096]) {
    const controller = new AbortController(), reason = Object.freeze({ id: 'independent-normalization-' + mode });
    const context = { signal: controller.signal };
    const parser = new Parser(new Budget(context, settings({})));
    await parser.feed('<em>a</em>' + '<b><span><i></i></span></b><a></a><code></code>'.repeat(count) + '<i>b</i>');
    const root = await parser.finish();
    const budget = new Budget(context, settings({ limits: mode === 'refusal' ? { maxWorkUnits: 64 } : {} }));
    const renderer = new Renderer(budget), original = budget.checkpoint.bind(budget);
    let queued = false, settled = false, triggerAt, caught, output;
    const events = [];
    if (mode === 'abort') budget.checkpoint = function () {
      if (!queued && budget.workUsed > 0 && budget.sinceYield >= 4096) {
        queued = true; events.push({ event: 'charged-checkpoint', work: budget.workUsed, aborted: controller.signal.aborted });
        setImmediate(() => { triggerAt = performance.now(); events.push({ event: 'trigger', settled }); controller.abort(reason); });
      }
      return original();
    };
    try { output = await renderer.document(root); } catch (error) { caught = error; } finally { settled = true; }
    const observation = { count, output, work: budget.workUsed, code: caught?.code, events, reasonIdentity: caught === reason, settlementMs: triggerAt === undefined ? null : performance.now() - triggerAt };
    observations.push(observation); actual = { observations };
    if (mode === 'scale') { assert.equal(caught, undefined); assert.equal(output, '*ab*\n'); }
    if (mode === 'refusal') { assert.equal(caught?.code, 'EFBIG'); assert.match(caught.message, /work limit exceeded/); assert(budget.workUsed <= 64); }
    if (mode === 'abort') { assert.equal(caught, reason); assert.equal(events[0].aborted, false); assert.equal(events[1].settled, false); assert(observation.settlementMs < 1000); }
  }
  if (mode === 'scale') for (let index = 1; index < observations.length; index++) assert(observations[index].work <= observations[index - 1].work * 4.1);
  console.log(JSON.stringify({ outcome: 'PASS', actual }));
} catch (error) { console.log(JSON.stringify({ outcome: 'FAIL', actual, error: error.stack })); process.exitCode = 1; }
