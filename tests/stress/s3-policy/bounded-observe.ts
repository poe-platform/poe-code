import { profileFixture, renameOutcome, type Profile } from "./profile-fixture.js";

const observations: unknown[] = [];
for (const profile of ["modern-copy", "classic-put", "stream-put"] as readonly Profile[]) {
  for (const stage of ["publish", "delete"] as const) {
    for (const mutate of ["metadata-only", "recreate-same", "ABA-different-then-same"] as const) {
      const setup = await profileFixture(profile, { source: "original" });
      const before = await setup.state();
      let fired = false;
      setup.before(async mutation => {
        if (fired || (stage === "delete" ? mutation.operation !== "delete" : mutation.operation === "delete")) return;
        fired = true;
        if (mutate === "recreate-same") await setup.actorDelete("source");
        if (mutate === "ABA-different-then-same") await setup.actorPut("source", "intermediate");
        await setup.actorPut("source", "original", { writer: mutate });
      });
      const error = await renameOutcome(setup.fs);
      const after = await setup.state();
      observations.push({ profile, stage, mutate, fired, resolved: error === undefined,
        error: error instanceof Error ? error.message : null,
        oldETag: before.source?.etag, sourceRemains: after.source !== undefined,
        after, classification: "identity limitation: same ETag cannot prove source incarnation unchanged; not an acceptance pass" });
    }
  }
}
console.log(JSON.stringify({ boundedScheduleCount: observations.length, observations }));
