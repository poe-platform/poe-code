import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/errors.js";
import { S3RenameError, S3ServiceError } from "../../../src/fs/s3/index.js";
import { bucket, profileFixture, renameOutcome, type Profile } from "./profile-fixture.js";

const profiles: readonly Profile[] = ["modern-copy", "classic-put", "stream-put"];
const options = { timeout: 5000 };

for (const profile of profiles) {
  for (const exists of [false, true]) {
    test(`${profile}: legitimate ${exists ? "replacement" : "new destination"} uses actually supported destination guards`, options, async () => {
      const setup = await profileFixture(profile, { source: "original", ...(exists ? { target: "old" } : {}) });
      const previous = await setup.state();
      const error = await renameOutcome(setup.fs);
      console.log(JSON.stringify({ profile, error: error instanceof Error ? error.message : null, mutations: setup.mutations }));
      assert.equal(error, undefined, "capable-client legitimate rename must remain available");
      const state = await setup.state();
      assert.equal(state.source, undefined);
      assert.equal(state.target?.text, "original");
      assert.deepEqual(state.target?.metadata, { origin: "seed" });
      assert.equal(setup.fs.capabilities.atomicRename, false);
      const publications = setup.mutations.filter(mutation => mutation.operation !== "delete");
      assert.equal(publications.length, 1);
      const publication = publications[0]!;
      assert.equal(publication.operation, profile === "modern-copy" ? "copy" : profile === "stream-put" ? "stream-put" : "put");
      if (exists) assert.equal(publication.input.IfMatch, previous.target?.etag);
      else assert.equal(publication.input.IfNoneMatch, "*");
      const deletion = setup.mutations.find(mutation => mutation.operation === "delete");
      assert.equal(deletion?.input.IfMatch, previous.source?.etag);
    });

    test(`${profile}: concurrent destination ${exists ? "replacement" : "creation"} cannot destroy the writer`, options, async () => {
      const setup = await profileFixture(profile, { source: "original", ...(exists ? { target: "old" } : {}) });
      setup.before(async mutation => {
        if (mutation.operation !== "delete") await setup.actorPut("target", "concurrent destination");
      });
      const error = await renameOutcome(setup.fs);
      const state = await setup.state();
      console.log(JSON.stringify({ resolved: error === undefined, state, mutations: setup.mutations }));
      assert.equal(state.target?.text, "concurrent destination");
      assert.equal(state.source?.text, "original");
      assert.ok(error instanceof S3RenameError);
      assert.equal(error.code, "EAGAIN");
      assert.equal(error.phase, "copy");
      assert.deepEqual(error.deletedKeys, []);
      assert.equal(setup.mutations.some(mutation => mutation.operation === "delete"), false);
    });
  }

  for (const stage of ["publish", "delete"] as const) {
    for (const recreate of [false, true]) {
      test(`${profile}: different-content ${recreate ? "recreation" : "mutation"} before ${stage} is retained`, options, async () => {
        const setup = await profileFixture(profile, { source: "original" });
        let fired = false;
        setup.before(async mutation => {
          if (fired || (stage === "delete" ? mutation.operation !== "delete" : mutation.operation === "delete")) return;
          fired = true;
          if (recreate) await setup.actorDelete("source");
          await setup.actorPut("source", "new source");
        });
        const error = await renameOutcome(setup.fs);
        const state = await setup.state();
        console.log(JSON.stringify({ fired, resolved: error === undefined, state }));
        assert.equal(fired, true);
        assert.equal(state.source?.text, "new source");
        assert.deepEqual(state.source?.metadata, { writer: "concurrent" });
        assert.ok(error instanceof S3RenameError);
        assert.equal(error.code, "EAGAIN");
        assert.deepEqual(error.deletedKeys, []);
      });
    }
  }

  for (const acknowledgementLost of [false, true]) {
    test(`${profile}: publication ${acknowledgementLost ? "lost acknowledgement" : "failure"} never permits source delete`, options, async () => {
      const setup = await profileFixture(profile, { source: "original" });
      const hook = async (mutation: { operation: string }) => {
        if (mutation.operation !== "delete") throw new S3ServiceError("RequestTimeout", 408);
      };
      if (acknowledgementLost) setup.after(hook); else setup.before(hook);
      const error = await renameOutcome(setup.fs);
      assert.ok(error instanceof S3RenameError);
      assert.equal(error.phase, "copy");
      assert.equal(error.code, "ETIMEDOUT");
      assert.deepEqual(error.copiedKeys, []);
      assert.deepEqual(error.deletedKeys, []);
      const state = await setup.state();
      assert.equal(state.source?.text, "original");
      assert.equal(state.target?.text, acknowledgementLost ? "original" : undefined);
      assert.equal(setup.mutations.some(mutation => mutation.operation === "delete"), false);
    });
  }

  for (const childCount of [1, 2, 4]) {
    test(`${profile}: preserves ${childCount} late source children without bulk deletion`, options, async () => {
      const setup = await profileFixture(profile, { "source/old": "original" });
      let inserted = false;
      setup.before(async mutation => {
        if (mutation.operation !== "delete" || inserted) return;
        inserted = true;
        for (let child = 0; child < childCount; child++) await setup.actorPut(`source/new-${child}`, `writer-${child}`);
      });
      const error = await renameOutcome(setup.fs);
      const state = await setup.state();
      console.log(JSON.stringify({ resolved: error === undefined, remainingSourceKeys: Object.keys(state).filter(key => key.startsWith("source/")) }));
      assert.equal(inserted, true);
      assert.equal(state["target/old"]?.text, "original");
      for (let child = 0; child < childCount; child++) assert.equal(state[`source/new-${child}`]?.text, `writer-${child}`);
      assert.ok(setup.mutations.filter(mutation => mutation.operation === "delete").every(mutation => mutation.input.Key === "source/old"));
      if (error !== undefined) assert.ok(error instanceof S3RenameError);
    });
  }
}

test("classic-put: buffered fallback refuses over-budget source before any publication", options, async () => {
  const setup = await profileFixture("classic-put", { source: "12345", target: "keep" }, 4);
  const error = await renameOutcome(setup.fs);
  console.log(JSON.stringify({ resolved: error === undefined, mutations: setup.mutations, state: await setup.state() }));
  assert.equal(setup.mutations.length, 0);
  assert.ok(error instanceof FsError);
  assert.equal(error.code, "EFBIG");
  assert.equal((await setup.state()).source?.text, "12345");
  assert.equal((await setup.state()).target?.text, "keep");
});

test("classic-put: conditional publication preserves binary bytes and source metadata", options, async () => {
  const setup = await profileFixture("classic-put", { source: "\u0000é\n" });
  const initial = await setup.client.getObject({ Bucket: bucket, Key: "source" });
  const error = await renameOutcome(setup.fs);
  assert.equal(error, undefined);
  const final = await setup.client.getObject({ Bucket: bucket, Key: "target" });
  assert.deepEqual(final.Body, initial.Body);
  assert.deepEqual(final.Metadata, initial.Metadata);
  assert.equal(setup.mutations.some(mutation => mutation.operation === "copy"), false);
});

test("stream-put: negotiated streaming avoids the smaller buffered-copy budget", options, async () => {
  const setup = await profileFixture("stream-put", { source: "12345" }, 4);
  assert.equal(await renameOutcome(setup.fs), undefined);
  assert.deepEqual(setup.reads, { buffered: 0, streaming: 1 });
  assert.deepEqual(setup.mutations.map(mutation => mutation.operation), ["stream-put", "delete"]);
  assert.equal((await setup.state()).target?.text, "12345");
});

for (const profile of ["classic-put", "stream-put"] as const) {
  test(`${profile}: abort before conditional publication retains source`, options, async () => {
    const setup = await profileFixture(profile, { source: "original" });
    const controller = new AbortController();
    setup.before(async mutation => { if (mutation.operation !== "delete") controller.abort(new Error("bounded cancellation")); });
    const error = await renameOutcome(setup.fs, controller.signal);
    assert.ok(error instanceof S3RenameError);
    assert.equal(error.code, "ECANCELED");
    assert.equal(error.phase, "copy");
    assert.equal((await setup.state()).source?.text, "original");
    assert.equal((await setup.state()).target, undefined);
    assert.equal(setup.mutations.some(mutation => mutation.operation === "delete"), false);
  });
}
