import {expect,it,vi} from 'vitest';
import {createRestExecutionDriver} from './rest-driver.js';

it('uses declarative existing-server bindings without a resolver or SDK',async()=>{
 const endpoints={'tenant-a':{origin:'https://existing.example',expiresAt:200}};
 const driver=createRestExecutionDriver({transport:'https',endpoints},undefined,async request=>{
  expect(request.url).toBe('https://existing.example/v1/capabilities');
  expect(request.headers.get('Authorization')).toBe('Bearer application-token');
  return new Response(null,{status:204});
 },()=>100);
 endpoints['tenant-a'].origin='https://replacement.example';
 const response=await (await driver.acquire('tenant-a')).fetch(new Request('https://gateway.example/v1/capabilities',{headers:{Authorization:'Bearer application-token'}}));
 expect(response.status).toBe(204);
});

it.each(['tenant-b','toString','__proto__'])('rejects unbound tenant %s without contacting an existing server',async namespaceId=>{
 const fetch=vi.fn(async()=>new Response(null));
 const driver=createRestExecutionDriver({transport:'https',endpoints:{'tenant-a':{origin:'https://existing.example',expiresAt:200}}},undefined,fetch,()=>100);
 await expect((await driver.acquire(namespaceId)).fetch(new Request('https://gateway.example/v1/jobs'))).rejects.toThrow('binding');
 expect(fetch).not.toHaveBeenCalled();
});

it('rejects expired declarative bindings and never provisions or destroys existing servers',async()=>{
 const fetch=vi.fn(async()=>new Response(null));
 const driver=createRestExecutionDriver({transport:'https',endpoints:{'tenant-a':{origin:'https://existing.example',expiresAt:100}}},undefined,fetch,()=>100);
 await expect((await driver.acquire('tenant-a')).fetch(new Request('https://gateway.example/v1/jobs'))).rejects.toThrow('expired');
 await driver.destroy('tenant-a');
 expect(fetch).not.toHaveBeenCalled();
});

it('requires either declarative bindings or a trusted resolver',()=>{
 expect(()=>createRestExecutionDriver({transport:'https'})).toThrow('bindings or resolver');
});
