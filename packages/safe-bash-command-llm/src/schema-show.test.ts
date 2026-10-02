import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import { createLlmCommand } from './command.js';
import { loadLlmStoredSchema, loadLlmStoredSchemaJson } from './stored-schema.js';
import fixture from './fixtures/schema-show-0.27.1.json' with { type: 'json' };

async function setup() {
  const fs = new MemoryFileSystem(); await fs.mkdir('/out');
  await fs.writeFile('/out/schema-show.db',inflateSync(Buffer.from(fixture.databaseZlib,'base64')));
  await fs.writeFile('/out/schema-show.db-wal',inflateSync(Buffer.from(fixture.walZlib,'base64')));
  return { fs, cwd:'/', env:{LLM_USER_PATH:'/out'}, signal:new AbortController().signal };
}

test('schema show output, help and errors match the pinned CLI', async () => {
  for (const expected of fixture.cases) {
    const context = await setup(); let stdout='',stderr='';
    const command = createLlmCommand({providers:[]});
    const result = await command.execute({...context,command:'llm',args:expected.args,stdin:toByteSource(''),
      stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
    assert.equal(result.exitCode,expected.exitCode,stderr);
    assert.equal(stdout,expected.stdout); assert.equal(stderr,expected.stderr);
  }
});

test('SDK migrated schema reads admit only selected bytes and preserve missing results', async () => {
  const context = await setup(); let admitted=0;
  assert.deepEqual(await loadLlmStoredSchema(context,'demo',{database:'/out/schema-show.db',migrate:true,admitBytes(size){admitted+=size;}}),fixture.schema);
  assert.ok(admitted>0);
  assert.equal(await loadLlmStoredSchema(context,'absent',{database:'/out/schema-show.db',migrate:true}),undefined);
  await assert.rejects(loadLlmStoredSchema(context,'demo',{database:'/out/schema-show.db',migrate:true,maxBytes:1}),/limit/);
  assert.deepEqual((await context.fs.readdir('/out')).map(entry=>entry.name),['schema-show.db']);
});

test('migrated native schema reads exceed scalar binding sizes with bounded transfers', async () => {
  const context=await setup(); let largest=0,total=0;
  const schema=await loadLlmStoredSchema(context,'large',{database:'/out/schema-show.db',migrate:true,maxBytes:200000,admitBytes(size){largest=Math.max(largest,size);total+=size;}});
  assert.equal(schema?.description,'é'.repeat(70000));
  assert.ok(total>65536); assert.ok(largest<=16384);
});

test('migrated schema reads decode native UTF-16 TEXT bytes', async () => {
  const context=await setup();
  await context.fs.writeFile('/out/utf16.db',inflateSync(Buffer.from(fixture.utf16DatabaseZlib,'base64')));
  assert.deepEqual(await loadLlmStoredSchema(context,'demo',{database:'/out/utf16.db',migrate:true}),fixture.schema);
});


test('schema display accepts JSON values while provider schemas remain objects', async () => {
  const { transactSqlite } = await import('./sqlite-transaction.js');
  const context=await setup();
  for (const [content, expected] of [['null','null\n'],['false','false\n'],['17','17\n'],['"hi"','"hi"\n'],['[1,2]','[\n  1,\n  2\n]\n']]) {
    await transactSqlite({fs:context.fs,path:'/out/schema-show.db',signal:context.signal,maxFileBytes:Number.MAX_SAFE_INTEGER,maxIndexBytes:Number.MAX_SAFE_INTEGER,maxOpenFiles:64}, async session => {
      await session.execute(`INSERT OR REPLACE INTO schemas (id,content) VALUES ('scalar','${content}')`);
    });
    let stdout='',stderr='';
    const result=await createLlmCommand({providers:[]}).execute({...context,command:'llm',args:['schemas','show','scalar','-d','/out/schema-show.db'],stdin:toByteSource(''),
      stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
    assert.equal(result.exitCode,0,stderr); assert.equal(stdout,expected); assert.equal(stderr,'');
    assert.equal(await loadLlmStoredSchemaJson(context,'scalar',{database:'/out/schema-show.db',migrate:true}),content);
    await assert.rejects(loadLlmStoredSchema(context,'scalar',{database:'/out/schema-show.db',migrate:true}),/Invalid schema/);
  }
});
