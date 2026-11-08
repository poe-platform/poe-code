import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/index.js";
import * as reference from "../../providers/dist/index.js";
test("declarative provider exports and deep freezes match original definitions", () => {
  assert.deepEqual(own.allAuthProviders, reference.allAuthProviders);
  assert.equal(Object.isFrozen(own.allAuthProviders), true);
  for (const provider of own.allAuthProviders) {
    assert.equal(Object.isFrozen(provider), true);
    assert.equal(Object.isFrozen(provider.auth), true);
    assert.equal(Object.isFrozen(provider.apiShapes), true);
  }
  for (const name of [
    "anthropicProvider",
    "cloudflareProvider",
    "openaiProvider",
    "poeProvider",
    "POE_PROVIDER_ID"
  ])
    assert.deepEqual(own[name], reference[name]);
});

test("effectful API shape selection matches getter, custom some and iterator closing behavior", () => {
  const run = (resolve, scenario) => {
    const reads = [],
      failure = Error("property failure");
    let count = 0;
    const shape = {
      get id() {
        reads.push("shape.id");
        if (scenario === 3) throw failure;
        return "x";
      }
    };
    const shapes = [
      shape,
      {
        get id() {
          reads.push("unused.id");
          throw Error("must skip");
        }
      }
    ];
    if (scenario === 4) shapes.some = () => 1;
    const iterator = {
      next() {
        reads.push("next");
        return count++ === 0 ? { done: false, value: "x" } : { done: true };
      },
      return() {
        reads.push("return");
        if (scenario === 2) return 42;
        return { done: true };
      }
    };
    if (scenario === 5)
      iterator.next.call = () => {
        throw Error("custom call must not run");
      };
    const provider = {
      get apiShapes() {
        reads.push("provider.apiShapes");
        return shapes;
      }
    };
    const agent = {
      get apiShapes() {
        reads.push("agent.apiShapes");
        return {
          [Symbol.iterator]() {
            reads.push("iterator");
            return iterator;
          }
        };
      }
    };
    try {
      return { value: resolve(provider, agent), reads };
    } catch (error) {
      return { name: error.name, reads, sameFailure: error === failure };
    }
  };
  for (let scenario = 0; scenario < 6; scenario++)
    assert.deepEqual(
      run(own.resolveApiShape, scenario),
      run(reference.resolveApiShape, scenario),
      "scenario " + scenario
    );
  const sparse = [];
  sparse.length = 2;
  sparse[1] = { id: "x" };
  assert.equal(own.resolveApiShape({ apiShapes: sparse }, { apiShapes: ["x"] }), "x");
});

test("registry duplicate-key decisions match opaque and changing credential key values", () => {
  const run = (Registry, scenario) => {
    const opaque = { key: true };
    let reads = 0;
    const auth = (key) => ({
      kind: "api-key",
      envVar: "API_KEY",
      storageKey: key,
      prompt: { title: "key" }
    });
    const providers = [
      { id: "one", label: "one", auth: auth(scenario === 0 ? opaque : undefined) },
      { id: "two", label: "two", auth: auth(scenario === 0 ? opaque : undefined) }
    ];
    if (scenario === 2) {
      providers[0].auth.storageKey = "first";
      Object.defineProperty(providers[1].auth, "storageKey", {
        get() {
          return reads++ === 0 ? "fresh" : "first";
        }
      });
    }
    try {
      const registry = new Registry(providers);
      return { ids: registry.list().map((p) => p.id), reads, unknown: registry.get(42) };
    } catch (error) {
      return { name: error.name, message: error.message, reads };
    }
  };
  for (let scenario = 0; scenario < 3; scenario++)
    assert.deepEqual(
      run(own.ProviderRegistry, scenario),
      run(reference.ProviderRegistry, scenario),
      "scenario " + scenario
    );
});

test("credential adapters retain opaque host trim results and original store identity", async () => {
  const run = async (strategy) => {
    const calls = [],
      provider = reference.poeProvider;
    const value = {
      trim() {
        calls.push("trim");
        return "owned";
      }
    };
    const context = {
      secretStore: {
        get: async () => value,
        set: async (key) => {
          calls.push(key);
        },
        delete: async () => {}
      }
    };
    const login = await strategy.login(provider, { apiKey: value }, context);
    const resolved = await strategy.resolveCredential(provider, context);
    return { login, resolved, calls };
  };
  assert.deepEqual(await run(own.apiKeyAuthStrategy), await run(reference.apiKeyAuthStrategy));
});

test("native API shape iteration releases rejected callback handles under bounded worker heap", async () => {
  const { Worker } = await import("node:worker_threads");
  const entry = new URL("../dist/index.js", import.meta.url).href;
  const worker = new Worker(
    `
 const {parentPort}=require('node:worker_threads');
 require('node:v8').setFlagsFromString('--expose-gc');const gc=require('node:vm').runInNewContext('gc');
 (async()=>{const {resolveApiShape}=await import(${JSON.stringify(entry)});let count=0;function* candidates(){for(let n=0;n<100000;n++){if(n%1024===0)gc();count++;yield ('candidate '+n).repeat(512);}}const result=resolveApiShape({apiShapes:[]},{apiShapes:candidates()});parentPort.postMessage({count,result});})().catch(error=>{throw error;});`,
    { eval: true, resourceLimits: { maxOldGenerationSizeMb: 16 } }
  );
  const result = await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code) reject(Error("worker exit " + code));
    });
  });
  assert.equal(result.count, 100000);
  assert.equal(result.result, undefined);
});
