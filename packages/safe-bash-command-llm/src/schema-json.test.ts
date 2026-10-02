import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSchemaJson } from './schema-json.js';
import fixtures from './fixtures/schema-json-display.json' with { type: 'json' };

test('schema JSON display matches Python integer, float, key ordering and scalar semantics', async () => {
  for (const fixture of fixtures) {
    let output='';
    await renderSchemaJson(fixture.input,async text=>{output+=text;},new AbortController().signal);
    assert.equal(output,fixture.output,fixture.input);
  }
});

test('invalid schema JSON emits no partial output and cancellation is observed', async () => {
  for (const input of ['[1,]', '{"x":1,}', '01', 'true false', '"unterminated', '{"x" 1}']) {
    let output='';
    await assert.rejects(renderSchemaJson(input,async text=>{output+=text;},new AbortController().signal));
    assert.equal(output,'');
  }
  const abort=new AbortController(); abort.abort();
  await assert.rejects(renderSchemaJson('{}',async()=>{},abort.signal));
});


test('schema JSON output remains chunked and stops after cancellation during emission', async () => {
  const abort=new AbortController(); let calls=0;
  await assert.rejects(renderSchemaJson(JSON.stringify({text:'é'.repeat(70000)}),async chunk=>{
    assert.ok(chunk.length<=16384); calls++; abort.abort();
  },abort.signal));
  assert.equal(calls,1);
});
