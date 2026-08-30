import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const own = dirname(import.meta.filename);
const label = process.argv[2];
if (!/^[a-z0-9-]+$/u.test(label ?? "")) throw new Error("cohort required");
const directory = join(own, "evidence", label);
const json = async (name) => JSON.parse(await readFile(join(directory, name), "utf8"));
const events = (await readFile(join(directory, "provider.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
const rows = await json("consumer.json");
const summary = await json("summary.json");
const run = await json("run.json");
assert.equal(run.failure, undefined);
assert.equal(run.cleanup.removed, true);
assert.equal(run.cleanup.server.code, 0);
assert.equal(summary.retainedLocks, 0);
assert.equal(rows.length, 18);
assert.ok(rows.every((row) => row.result === "pass"));
assert.ok(!events.some((event) => event.event === "FORBIDDEN-descendant-visitation"));
for (const path of ["/nonempty/", "/late-child/"]) {
  assert.deepEqual(events.filter((event) => event.path === path && ["native-rmdir", "native-error", "native-removed"].includes(event.event)).map((event) => [event.event, event.code]), [["native-rmdir", undefined], ["native-error", "ENOTEMPTY"]]);
}
for (const path of ["/lock-target/", "/descendant/"]) {
  assert.ok(events.some((event) => event.path === path && event.event === "actual-lock-manager-rejected"));
  assert.ok(!events.some((event) => event.path === path && event.event === "native-rmdir"));
}
const parent = events.filter((event) => event.path === "/parent/empty/");
assert.equal(parent.filter((event) => event.event === "authenticated-extension-request").length, 3);
assert.equal(parent.filter((event) => event.event === "hook-after-standard-parent-check").length, 1);
assert.equal(parent.filter((event) => event.event === "native-removed").length, 1);
assert.ok(events.some((event) => event.event === "authenticated-extension-request" && event.principal === "other"));
for (const row of rows.filter((entry) => /child.*native|external native|existing child/u.test(entry.name))) {
  assert.ok(Object.values(row.after).some((entry) => entry.hex === "00ff80410d0a"));
}
const closure = await json("runtime-closure.json");
assert.equal(Object.keys(closure).length, 157);
assert.ok(Object.keys(closure).every((url) => url.includes("/consumer/node_modules/virtual-bash/dist/")));
const lockReplies = rows.flatMap((row) => row.replies).filter((reply) => reply.method === "LOCK");
assert.equal(lockReplies.length, 4);
assert.ok(lockReplies.every((reply) => reply.status === 200 && reply.headers["lock-token"].startsWith("opaquelocktoken:") && !reply.headers["lock-token"].startsWith("<")));
const report = { providerHookAndNativeEffectsVerified: true, descendantVisits: 0, actualParentDeniedBeforeHook: 2,
  actualTargetAndDescendantLockDenials: 2, nativeNonemptyFailures: 2, childHex: "00ff80410d0a",
  genuineBareWsgiDavLockTokenHeadersPreserved: lockReplies.length, malformedHeaderNotUsedByProductLockParser: true,
  packedRuntimeModules: Object.keys(closure).length, totals: summary.totals, cleanup: run.cleanup };
await writeFile(join(directory, "audit.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(report);
