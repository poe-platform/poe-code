import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { settings, type Budget } from "safe-bash-io-engine/commands/archive/internal";
import { inspectZipMoveSource, removeZipSources } from "./zip/move.js";
import { ZipScope } from "./zip/safety.js";
import { toByteSource, type FileStat } from "safe-bash-contracts";

for (const foreign of [false, true]) test(`ZIP move uses backed ordering and advances only owned revisions (foreign=${foreign})`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/deep", {recursive:true});
  await fs.writeFile("/work/deep/a", new Uint8Array([1]));
  await fs.link!("/work/deep/a", "/work/b");
  if (foreign) {
    const remove = fs.removeEntryConditional.bind(fs);
    fs.removeEntryConditional = async (path, options) => {
      await remove(path, options);
      if (path === "/work/deep/a") await fs.writeFile("/work/b", new Uint8Array([9]));
    };
  }
  const signal = new AbortController().signal;
  const scope = new ZipScope({command:"zip", args:[], cwd:"/", env:{}, fs,signal,stdin:toByteSource(""),stdout:{async write(){}},stderr:{async write(){}}}, settings({}));
  const scopes: unknown[] = [];
  const backing = {
    createMap<T>() {
      const values = new Map<string,T>();
      return {async get(key:string) { return values.get(key); }, async set(key:string,value:T) {values.set(key,value);}, async *sortedEntries(): AsyncIterable<[string,T]> {yield* [...values].sort(([a],[b])=>a<b?-1:a>b?1:0);} };
    },
    identityKey(stat:FileStat) { let id=scopes.indexOf(stat.identityScope);if(id<0){id=scopes.length;scopes.push(stat.identityScope);}return `${id}:${stat.dev}:${stat.ino}`; }
  };
  const paths = ["/work", "/work/b", "/work/deep", "/work/deep/a"];
  const sources = [];
  for (const path of paths) sources.push(await inspectZipMoveSource(scope,path,path));
  let warning = "";
  const budget = {async output(value:string) {warning+=value;}} as Budget;
  await removeZipSources(scope,(async function*(){yield* sources;})(),budget,false,backing);
  if (foreign) {
    assert.match(warning, /error deleting \/work\/b/);
    assert.deepEqual(await fs.readFile("/work/b"), new Uint8Array([9]));
    await assert.rejects(fs.lstat("/work/deep"), {code:"ENOENT"});
  } else {
    assert.equal(warning, "");
    await assert.rejects(fs.lstat("/work"), {code:"ENOENT"});
  }
  await scope.close();
});
