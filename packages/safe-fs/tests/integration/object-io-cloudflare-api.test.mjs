import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCloudflareQualificationApi } from './object-io-cloudflare-api.mjs';

test('qualification API authenticates JSON requests and never follows redirects', async () => {
  const calls=[];
  const api=createCloudflareQualificationApi({token:'synthetic-deploy-token',fetch:async (url,options) => {
    calls.push({url,options});
    return Response.json({success:true,result:{name:'owned-bucket'}});
  }});
  const result=await api('/accounts/synthetic/r2/buckets',{method:'POST',body:{name:'owned-bucket'}});
  assert.equal(result.success,true);
  assert.equal(result.status,200);
  assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic-deploy-token');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.body,'{"name":"owned-bucket"}');
});

test('qualification API leaves multipart Content-Type generation to fetch', async () => {
  let options;
  const body=new FormData();
  body.set('metadata','synthetic');
  const api=createCloudflareQualificationApi({token:'synthetic',fetch:async (_,input) => {
    options=input;return Response.json({success:true,result:{}});
  }});
  await api('/accounts/synthetic/workers/scripts/owned',{method:'PUT',body});
  assert.equal(options.body,body);
  assert.equal(options.headers['Content-Type'],undefined);
});

test('qualification API rejects off-origin paths and redacts upstream failure bodies', async () => {
  let calls=0;
  const api=createCloudflareQualificationApi({token:'synthetic',fetch:async () => {
    calls++;return new Response('synthetic-private-upstream-content',{status:502});
  }});
  for (const path of ['https://foreign.example','//foreign.example','/accounts/../foreign','/accounts/test?secret=1']) {
    await assert.rejects(api(path));
  }
  assert.equal(calls,0);
  await assert.rejects(api('/accounts/test/workers/scripts/owned'),error =>
    error.message==='Cloudflare qualification API returned non-JSON status 502');
});

test('qualification API bounds upstream response bodies', async () => {
  const api=createCloudflareQualificationApi({token:'synthetic',fetch:async () =>
    new Response('x'.repeat(1048577))});
  await assert.rejects(api('/accounts/test/workers/scripts/owned'),/byte limit/);
});
