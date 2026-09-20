import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const {NativeDerivedKeyCache}=createRequire(import.meta.url)("../dist/auth-store-rust.node");
test("native derived key retention is bounded through churn and returns independent buffers",()=> {
  const cache=new NativeDerivedKeyCache();
  for(let index=0;index<4096;index++) {
    const key=String(index)+"\ud800";const source=Buffer.alloc(32,index&255);cache.insert(key,source);source.fill(0);
    const value=cache.lookup(key);assert.deepEqual(value,Buffer.alloc(32,index&255));value.fill(0);
    assert.deepEqual(cache.lookup(key),Buffer.alloc(32,index&255));assert.equal(cache.size,Math.min(index+1,64));
    if(index>=64)assert.equal(cache.lookup(String(index-64)+"\ud800"),null);
  }
  cache.insert("a".repeat(16385),Buffer.alloc(32));assert.equal(cache.size,64);assert.equal(cache.lookup("a".repeat(16385)),null);
  assert.throws(()=>cache.insert("bad",Buffer.alloc(31)),/32 bytes/);
});
