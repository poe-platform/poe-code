import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCloudflareQualificationApi, probeCloudflareQualificationApi } from './object-io-cloudflare-api.mjs';

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

test('qualification API retains only bounded numeric upstream error codes for diagnosis', async () => {
  const api=createCloudflareQualificationApi({token:'synthetic',fetch:async () => Response.json({success:false,
    errors:[{code:9109,message:'synthetic-private-upstream-content'},{code:9109},
      {code:'private-string'},{code:-1},{code:10007}]},{status:403})});
  const result=await api('/accounts/test/workers/scripts/owned');
  assert.deepEqual(result.errorCodes,[9109,10007]);
  assert.equal(JSON.stringify(result).includes('synthetic-private'),false);
});

test('qualification access probe is read-only and reports no account, path, or resource identifiers', async () => {
  const calls=[];
  const accountId='0123456789abcdef0123456789abcdef';
  const result=await probeCloudflareQualificationApi({accountId,runId:'1234',api:async (path,options={}) => {
    calls.push({path,method:options.method??'GET'});
    return {status:403,success:false,errorCodes:[9109],result:{secret:'synthetic-private-content'}};
  }});
  assert.equal(result.length,3);
  assert.deepEqual(result.map(row=>row.resource),['worker','bucket','subdomain']);
  assert.ok(result.every(row=>row.status===403&&row.errorCodes[0]===9109));
  assert.ok(calls.every(call=>call.method==='GET'));
  assert.equal(JSON.stringify(result).includes(accountId),false);
  assert.equal(JSON.stringify(result).includes('synthetic-private'),false);
});
