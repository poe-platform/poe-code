import assert from "node:assert/strict";
import { executeBytes } from "./harness.js";

const scenario = process.argv[2];
if (scenario === "coefficient") {
  const result = await executeBytes(["-c", ".?"], Buffer.from("1".repeat(100000)), { limits: { maxInputBytes: 200000, maxValueBytes: 200000, maxSteps: 128 } });
  assert.equal(result.status, 5);
  assert.equal(result.stdoutHex, "");
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), /maxSteps/);
} else if (scenario === "comparison") {
  const first = `1.${"2".repeat(8000)}1`;
  const second = `1.${"2".repeat(8000)}2`;
  const result = await executeBytes(["-nc", `any(range(10000000);${first}>${second})?`], Buffer.alloc(0), { limits: { maxSteps: 4096 } });
  assert.equal(result.status, 5);
  assert.equal(result.stdoutHex, "");
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), /maxSteps/);
} else if (scenario === "cancel") {
  const controller = new AbortController();
  const reason = new Error("numeric CPU cancellation");
  const timer = setTimeout(() => controller.abort(reason), 10);
  const coefficient = `1.${"2".repeat(4000)}`;
  try {
    await assert.rejects(executeBytes(["-nc", `any(range(1000000000);${coefficient}==${coefficient} and empty)?`], Buffer.alloc(0), { limits: { maxSteps: 100000000 } }, { signal: controller.signal }), error => error === reason);
  } finally { clearTimeout(timer); }
} else if (scenario === "render-cancel") {
  const controller = new AbortController();
  const reason = new Error("numeric rendering cancellation");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const coefficient = `1.${"2".repeat(16000)}`;
  let writes = 0;
  try {
    await assert.rejects(executeBytes(["-nc", `0,(range(1000000000)|${coefficient}|tojson|empty)`], Buffer.alloc(0), { limits: { maxSteps: 100000000 } }, {
      signal: controller.signal,
      stdout: { async write() { writes++; timer = setTimeout(() => controller.abort(reason), 10); } },
    }), error => error === reason);
  } finally { clearTimeout(timer); }
  assert.equal(writes, 1);
} else throw new Error("unknown numeric scenario");
console.log("ok");
