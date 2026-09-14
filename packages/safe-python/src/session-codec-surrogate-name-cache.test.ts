import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecSurrogateNameCacheCases, codecSurrogateNameServiceSource} from "./codec-surrogate-name-cache-cases.js";

it.each(codecSurrogateNameCacheCases)("surrogatepass encoding cache: $name", ({source}) => {
  const session = new PythonSession({hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {return "8\n";}}, output: {write() {}, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
});

it.each([false, true])("encoding-name recovery cancellation remains terminal (throws=%s)", throws => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({signal: controller.signal, hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, output: {write() {}, flush() {}}, input: {
    readLine() {
      reads++;
      controller.abort();
      if (throws) throw Error("service cancelled and failed");
      return "8\n";
    }
  }});
  const result = session.exec(codecSurrogateNameServiceSource);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(session.exec("pass")).toMatchObject({status: "terminated", reason: "cancelled"});
});
