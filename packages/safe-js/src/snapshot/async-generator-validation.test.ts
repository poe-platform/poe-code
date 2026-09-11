import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { SnapshotValidationError } from "./validation.js";

it.each(["resolver", "duplicate request", "operation", "handler owner", "future handler", "handler action", "running", "empty waiting", "source phase", "frame owner", "missing request owner", "wrong request owner", "orphaned request"])(
  "rejects malformed async generator continuation: %s", async alteration => {
    const source = "const c=Promise.withResolvers();async function* values(){yield await c.promise;yield 2}const it=values();const first=it.next(),second=it.next();return ()=>[first,second,c.resolve]";
    const result = await run(source);assert(result.ok);
    const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const wire = JSON.parse(JSON.stringify(snapshot));
    const nodes = Object.values(wire.heap as Record<string, Record<string, unknown>>);
    const driver = nodes.find(node => node.kind === "async-generator-driver");
    const handler = nodes.find(node => node.kind === "async-generator-handler");
    const frame = nodes.find(node => node.kind === "guest-generator" && node.awaitPhase !== undefined);
    assert(driver && handler && frame);
    const requests = driver.requests as Array<{method:string;capability:Record<string, unknown>}>;
    assert(requests.length === 2);
    if (alteration === "resolver") requests[0]!.capability.resolve = requests[0]!.capability.reject;
    else if (alteration === "duplicate request") requests[1]!.capability = requests[0]!.capability;
    else if (alteration === "operation") requests[0]!.method = "dispose";
    else if (alteration === "handler owner") handler.owner = requests[1]!.capability.promise;
    else if (alteration === "future handler") handler.generation = Number(driver.generation) + 1;
    else if (alteration === "handler action") handler.action = "return";
    else if (alteration === "running") driver.phase = "running";
    else if (alteration === "empty waiting") driver.requests = [];
    else if (alteration === "source phase") frame.awaitPhase = "return";
    else if (alteration === "missing request owner" || alteration === "wrong request owner" || alteration === "orphaned request") {
      const request = wire.heap[(requests[1]!.capability.promise as {id:number}).id];
      if (alteration === "missing request owner") delete request.generatorOwner;
      else if (alteration === "wrong request owner") request.generatorOwner = requests[0]!.capability.promise;
      else driver.requests = requests.slice(0,1);
    }
    else delete frame.driver;
    expect(() => restore(wire, {source})).toThrow(SnapshotValidationError);
  }
);
