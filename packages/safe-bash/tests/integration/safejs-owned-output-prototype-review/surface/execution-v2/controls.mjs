import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const bytes = readFileSync(new URL("./child.mjs", import.meta.url));
const childSha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(childSha256, "358dffdec0e11672206beb3c74d97a5cda44f55b83c8104dec9717543a2c64f4");
const source = bytes.toString();
const start = source.indexOf('      record.engineOutcome = { kind: "entered" };');
const end = source.indexOf("      record.engine = result.ok", start);
assert.ok(start > 0 && end > start);
const observer = source.slice(start, end);
assert.ok(!observer.includes("errorInfo") && !observer.includes("reason."));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const observe = new AsyncFunction("run", "actualSource", "forwarded", "record", observer + "\nreturn result;\n");
const sourceToken = Object.freeze({ source: "finite-control-not-guest" });
const optionsToken = Object.freeze({ options: "finite-control-not-runtime" });
const sentinel = Object.freeze({ marker: "finite-reason" });
let getterReads = 0;
const getterReason = Object.freeze(Object.defineProperty({}, "message", {
  get() { getterReads += 1; throw new Error("Observer must not read this getter"); },
}));
const controls = [
  { id: "fulfilled-ok", mode: "fulfilled", value: Object.freeze({ ok: true, returnValue: sentinel }) },
  { id: "fulfilled-error-result", mode: "fulfilled", value: Object.freeze({ ok: false, error: sentinel }) },
  { id: "synchronous-call-throw", mode: "call-threw", value: sentinel },
  { id: "awaited-object-rejection", mode: "await-rejected", value: sentinel },
  ...[undefined, null, false, 0].map((value, index) => ({ id: `awaited-primitive-${index}`, mode: "await-rejected", value })),
  { id: "awaited-getter-reason", mode: "await-rejected", value: getterReason },
];
const results = [];
for (const control of controls) {
  let calls = 0;
  let received;
  let rejected = false;
  let finalizers = 0;
  const record = { engineOutcome: { kind: "not-entered" }, events: [] };
  const run = (actualSource, forwarded) => {
    calls += 1;
    assert.equal(actualSource, sourceToken);
    assert.equal(forwarded, optionsToken);
    if (control.mode === "call-threw") throw control.value;
    return control.mode === "fulfilled" ? Promise.resolve(control.value) : Promise.reject(control.value);
  };
  try { received = await observe(run, sourceToken, optionsToken, record); }
  catch (reason) { rejected = true; received = reason; }
  finally { finalizers += 1; record.events.push("finite-finally"); }
  assert.equal(calls, 1);
  assert.equal(finalizers, 1);
  assert.equal(rejected, control.mode !== "fulfilled");
  assert.ok(Object.is(received, control.value));
  assert.equal(getterReads, 0);
  const outcome = control.mode === "fulfilled" ? { kind: "fulfilled" }
    : { kind: control.mode, reasonType: typeof control.value, reasonIsNull: control.value === null };
  assert.deepEqual(record.engineOutcome, outcome);
  const event = control.mode === "fulfilled" ? "actual-engine-run-settled"
    : control.mode === "call-threw" ? "actual-engine-run-threw" : "actual-engine-run-rejected";
  assert.deepEqual(record.events, ["actual-engine-run-start", event, "finite-finally"]);
  results.push({ id: control.id, pass: true, calls, finalizers, sameReferenceOrPrimitive: true,
    getterReads, outcome, events: record.events });
}
process.stdout.write(JSON.stringify({ qualification: "Finite host-only controls of exact extracted observer; not guest or engine acceptance; unchanged fulfilled recorder excluded",
  childSha256, observerSha256: createHash("sha256").update(observer).digest("hex"),
  guestExecutions: 0, productImports: 0, privateEngineImports: 0, results,
}, null, 2) + "\n");
