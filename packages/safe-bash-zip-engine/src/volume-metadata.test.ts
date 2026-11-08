import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes } from "safe-bash-contracts";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { makeZipEntry, writeZipArchive, type ZipMetadataSpool } from "./zip-format.js";
import { splitZipRanges, splitZipVolumes } from "./zip/volumes.js";

test("split metadata spills member records and patches without changing volume bytes", async () => {
  const signal = new AbortController().signal;
  const limits = settings({});
  const entries = [];
  for (let index=0;index<300;index++) entries.push(await makeZipEntry(`entry-${index}`, new Uint8Array(300).fill(index), {modified:new Date(2026,0,1),mode:0o100644,directory:false,symlink:false},limits,signal,0));
  const bytes=await writeZipArchive({entries,comment:new Uint8Array()},limits,signal,true,true);
  const expected=await splitZipVolumes(bytes,65536,limits,signal);
  let opened=0;
  const spools:ZipMetadataSpool[]=[];
  const factory=async ():Promise<ZipMetadataSpool>=>{
    opened++;
    const chunks:Uint8Array[]=[];
    const spool={async append(bytes:Uint8Array){assert.ok(bytes.length<=65536);chunks.push(new Uint8Array(bytes));},async finish(){const bytes=await collectBytes((async function*(){yield*chunks;})(),{});return {size:bytes.length,async read(offset:number,length:number){assert.ok(length<=65536);return bytes.slice(offset,offset+length);}};},async close(){chunks.length=0;}};
    spools.push(spool);return spool;
  };
  const actual=await splitZipRanges({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},65536,limits,signal,factory);
  assert.ok(opened>0);
  assert.equal(actual.length,expected.length);
  for(let index=0;index<actual.length;index++) assert.deepEqual(await collectBytes(actual[index]!.source(),{signal}),expected[index]);
  for(const spool of spools)await spool.close();
});

import { MemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { ZipScope } from "./zip/safety.js";
import { publishZipVolumes } from "./zip/volumes.js";

test("split publication replays async source paths and refuses a late volume alias before staging", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const signal = new AbortController().signal;
  const scope = new ZipScope({command:"zip",args:[],cwd:"/",env:{},fs,signal,stdin:toByteSource(""),stdout:{async write(){}},stderr:{async write(){}}},settings({}));
  let scans=0;
  const paths={async *[Symbol.asyncIterator](){scans++;yield "/work/input";yield "/work/archive.zip";}};
  const parentStat=await fs.lstat("/work");
  await assert.rejects(publishZipVolumes(scope,{output:"/work/archive.zip",parent:"/work",parentName:"/work",existing:undefined,parentStat},[new Uint8Array(1),new Uint8Array(1)],paths,async()=>{assert.fail("must reject aliases before staging");}),/aliases an input volume/);
  assert.equal(scans,2);
  assert.deepEqual(await fs.readdir("/work"),[]);
  await scope.close();
});
