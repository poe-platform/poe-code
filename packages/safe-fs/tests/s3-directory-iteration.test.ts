import {expect,test} from 'vitest';
import type {FileSystem} from '../src/contracts/filesystem.js';
import {MockS3Client,S3FileSystem} from '../src/fs/s3/index.js';

async function fixture(){
 const transport=new MockS3Client({buckets:['bucket'],pageSize:1});
 for(const key of ['dir/a','dir/b','dir/nested/c'])await transport.putObject({Bucket:'bucket',Key:key,Body:Uint8Array.of(1)});
 const fs=new S3FileSystem({transport,bucket:'bucket',pageSize:1});return {transport,fs};
}

test('S3 directory iteration is lazy, paged, and stops fetching after return',async()=>{
 const {transport,fs}=await fixture();
 const iterate=(fs as FileSystem).iterateDirectory;expect(iterate).toBeTypeOf('function');
 fs.readdir=async()=>{throw new Error('eager fallback');};
 const before=transport.requests.length,iterator=iterate!.call(fs,'/dir')[Symbol.asyncIterator]();
 expect(transport.requests).toHaveLength(before);
 expect(await iterator.next()).toEqual({done:false,value:{name:'a',type:'file'}});
 const after=transport.requests.length;await iterator.return!();expect(transport.requests).toHaveLength(after);
 const entries=[];for await(const entry of iterate!.call(fs,'/dir'))entries.push(entry);
 expect(entries).toEqual([{name:'a',type:'file'},{name:'b',type:'file'},{name:'nested',type:'directory'}]);
});

test('S3 directory iteration rejects cancellation between pulls and file/prefix collisions',async()=>{
 const {transport,fs}=await fixture();const iterate=(fs as FileSystem).iterateDirectory;expect(iterate).toBeTypeOf('function');
 const controller=new AbortController(),iterator=iterate!.call(fs,'/dir',{signal:controller.signal})[Symbol.asyncIterator]();
 await iterator.next();const before=transport.requests.length;controller.abort();await expect(iterator.next()).rejects.toMatchObject({code:'ECANCELED'});expect(transport.requests).toHaveLength(before);
 await transport.putObject({Bucket:'bucket',Key:'dir/a/child',Body:Uint8Array.of(1)});
 await expect(iterate!.call(fs,'/dir')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:'ENOTSUP'});
});

test('S3 iterator snapshots a page and its continuation before caller pauses',async()=>{
 const {transport}=await fixture();const original=transport.listObjectsV2.bind(transport);
 let page:Awaited<ReturnType<typeof original>>|undefined;
 transport.listObjectsV2=async(input,options)=>{const result={...await original(input,options)};if(input.Delimiter)page=result;return result;};
 const fs=new S3FileSystem({transport,bucket:'bucket',pageSize:1});const iterator=fs.iterateDirectory('/dir')[Symbol.asyncIterator]();
 expect((await iterator.next()).value).toEqual({name:'a',type:'file'});
 Object.assign(page!,{IsTruncated:false,NextContinuationToken:'poison'});
 expect((await iterator.next()).value).toEqual({name:'b',type:'file'});
 await iterator.return!();
});

test('S3 pagination rejects repeated token cycles and caps empty pages',async()=>{
 for(const limit of [undefined,2]){
  const {transport}=await fixture();const original=transport.listObjectsV2.bind(transport);let calls=0;
  transport.listObjectsV2=async(input,options)=>input.Delimiter?{IsTruncated:true,NextContinuationToken:['a','b','c','b','c'][Math.min(calls++,4)]}:original(input,options);
  const fs=new S3FileSystem({transport,bucket:'bucket',...(limit?{maxListEntries:limit}:{})});
  await expect(fs.iterateDirectory('/dir')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:limit?'EFBIG':'EIO'});
  expect(calls).toBeLessThanOrEqual(6);
 }
});

test('S3 iterator rejects oversized pages and honors request admission',async()=>{
 const {transport}=await fixture();const original=transport.listObjectsV2.bind(transport);
 transport.listObjectsV2=async(input,options)=>input.Delimiter?{Contents:[{Key:'dir/a',Size:1},{Key:'dir/b',Size:1}]}:original(input,options);
 const fs=new S3FileSystem({transport,bucket:'bucket',pageSize:1});
 await expect(fs.iterateDirectory('/dir')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:'EIO'});
 const before=transport.requests.length,limited=new S3FileSystem({transport,bucket:'bucket',maxRequests:1});
 await expect(limited.iterateDirectory('/dir')[Symbol.asyncIterator]().next()).rejects.toMatchObject({code:'EFBIG'});
 expect(transport.requests.length-before).toBe(1);
});

test('buffered S3 listing still rejects any repeated token, even when later tokens would advance',async()=>{
 const {transport}=await fixture();const original=transport.listObjectsV2.bind(transport);let calls=0;
 const tokens=['a','b','c','b','d'];
 transport.listObjectsV2=async(input,options)=>input.Delimiter?calls<tokens.length?{IsTruncated:true,NextContinuationToken:tokens[calls++]}:{IsTruncated:false}:original(input,options);
 const fs=new S3FileSystem({transport,bucket:'bucket'});
 await expect(fs.readdir('/dir')).rejects.toMatchObject({code:'EIO'});
 expect(calls).toBe(4);
});
