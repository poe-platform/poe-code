import {createFsFromVolume,Volume}from'memfs';
import {expect,it}from'vitest';
import{createDiskAdmissionStore}from'./admissions.js';
it('pins invocation identity and nested recovery evidence before queued publication yields',async()=>{
 const fs=createFsFromVolume(Volume.fromJSON({'/ledger':null})).promises;await fs.chmod('/ledger',0o700);
 const store=createDiskAdmissionStore({root:'/ledger',fs:fs as never,ownerId:(await fs.lstat('/ledger')).uid,maxRecordBytes:8192});
 const record:import('./admissions.js').AdmissionRecord={operationId:'original',epoch:'e',tenantId:'t',principalId:'p',kind:'job-state',requestDigest:'a'.repeat(64),buildDigest:'b'.repeat(64),retainedUntil:100,
  jobState:{version:1,sequence:'1',stage:'accepted',retainedUntil:100,effectBarrier:'0'}};
 const original=structuredClone(record);
 const pending=store.record(record);
 record.operationId='replacement';record.requestDigest='c'.repeat(64);record.buildDigest='d'.repeat(64);record.retainedUntil=0;record.jobState!.stage='sandbox-lost';
 await pending;
 expect(await store.inspect('original')).toEqual(original);
 expect(await store.inspect('replacement')).toBeNull();
 await store.record(original);
 await expect(store.record({...original,requestDigest:record.requestDigest})).rejects.toThrow('conflict');
 await store.sweep!(99);expect(await store.inspect('original')).toEqual(original);
 await store.sweep!(100);expect(await store.inspect('original')).toBeNull();
});
it('durably admits identical records once and rejects conflicting recovery identities using memfs',async()=>{
 const volume=Volume.fromJSON({'/ledger':null});const fs=createFsFromVolume(volume).promises;await fs.chmod('/ledger',0o700);
 const store=createDiskAdmissionStore({root:'/ledger',fs:fs as never,ownerId:(await fs.lstat('/ledger')).uid,maxRecordBytes:1024});
 const record={operationId:'operation',epoch:'epoch',tenantId:'tenant',principalId:'principal',kind:'job',requestDigest:'a'.repeat(64),buildDigest:'b'.repeat(64)};
 await store.record(record);await store.record(record);expect(await store.inspect('operation')).toEqual(record);
 await expect(store.record({...record,requestDigest:'c'.repeat(64)})).rejects.toThrow('conflict');expect((await fs.readdir('/ledger')).length).toBe(1);
});
it('checks ledger bounds and private root before writing and never creates a missing configured root',async()=>{
 const volume=Volume.fromJSON({});const fs=createFsFromVolume(volume).promises;const store=createDiskAdmissionStore({root:'/missing',fs:fs as never,ownerId:0,maxRecordBytes:128});
 await expect(store.record({operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)})).rejects.toThrow();expect(volume.toJSON()).toEqual({});
 const bounded=createDiskAdmissionStore({root:'/missing',fs:fs as never,ownerId:0,maxRecordBytes:8});await expect(bounded.record({operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)})).rejects.toThrow('bound');
});

it('reclaims durable records only at their advertised TTL and preserves records without a cleanup deadline',async()=>{
 const fs=createFsFromVolume(Volume.fromJSON({'/ledger':null})).promises;await fs.chmod('/ledger',0o700);
 const store=createDiskAdmissionStore({root:'/ledger',fs:fs as never,ownerId:(await fs.lstat('/ledger')).uid,maxRecordBytes:8192,maxRecords:3});
 const record={operationId:'expired',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64),retainedUntil:100};
 await store.record(record);await store.record({...record,operationId:'permanent',retainedUntil:undefined});
 await store.sweep!(99);expect(await store.inspect('expired')).not.toBeNull();
 await store.sweep!(100);expect(await store.inspect('expired')).toBeNull();expect(await store.inspect('permanent')).not.toBeNull();
});
