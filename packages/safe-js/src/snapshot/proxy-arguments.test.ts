import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";
import { validateDumpEnvelope } from "./validation.js";

it.each(['new Proxy(arguments,{})', 'new Proxy({},arguments)'])
("accepts an arguments object in %s", async expression => {
  const source = `Number.prototype.saved=(function(a){return ${expression}})(1);await 0;return 1`;
  const pending = run(source);
  const snapshot = JSON.parse(await dump(pending));
  await pending;
  expect(() => validateDumpEnvelope(snapshot, {source})).not.toThrow();
  expect(() => restoreDump(snapshot, { source })).not.toThrow();
});

