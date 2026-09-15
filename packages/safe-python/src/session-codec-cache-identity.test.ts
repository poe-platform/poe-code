import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecCacheIdentityCases} from "./codec-cache-identity-cases.js";
import reference from "./runtime/__snapshots__/codec-cache-identity-audit.json" with {type: "json"};

it.each(codecCacheIdentityCases)("codec cache identity: $name", ({name, source}) => {
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(oracle.source).toBe(source);
  expect(oracle.exitCode).toBe(0);
  expect(oracle.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  let diagnostic: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const message = session.eval("repr(failure)");
    if (message.status === "ok") diagnostic = String(message.value.primitive);
  }
  expect(result.status, diagnostic).toBe("ok");
  expect(output).toBe(oracle.stdout);
});
