import assert from "node:assert/strict";
import { run } from "./helpers.js";

const scenario = process.argv[2];
if (scenario === "source") {
  const result = await run(["-nc", "(".repeat(10000) + "0" + ")".repeat(10000)]);
  assert.match(result.stderr, /maxAstDepth/);
  assert.match((await run(["-nc", ".a".repeat(16000) + "=0"])).stderr, /maxAstDepth/);
} else if (scenario === "json") {
  const result = await run(["-c", "."], "[".repeat(10000) + "0" + "]".repeat(10000));
  assert.match(result.stderr, /maxDepth/);
} else if (scenario === "expansion") {
  const result = await run(["-nc", Array(30).fill("(0,1)").join("|") + "|select(false)"], "", { limits: { maxSteps: 10000 } });
  assert.match(result.stderr, /maxSteps/);
} else if (scenario === "allocation") {
  const result = await run(["-nc", '.[999999999999]=("x"*100000000000)']);
  assert.match(result.stderr, /maxValueBytes/);
} else if (scenario === "cancel") {
  const controller = new AbortController(); const reason = new Error("cancel worker");
  const timer = setTimeout(() => controller.abort(reason), 10);
  await assert.rejects(run(["-nc", "range(1000000000)|select(false)"], "", {}, { signal: controller.signal }), error => error === reason);
  clearTimeout(timer);
} else throw new Error("unknown scenario");
console.log("ok");
