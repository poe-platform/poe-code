import assert from "node:assert/strict";
import test from "node:test";
import * as sdk from "poe-code/safe-js";
import * as core from "poe-code/safe-js/core";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { makeSafeJsFsModule } from "../../../src/integrations/safejs/index.js";

// Shared functions keep the first identity encountered in sorted module exports.
for (const [operation, expectedOperation] of [["appendFile", "appendFile"], ["writeFile", "default.writeFile"]] as const) {
  for (const [route, recipient] of [["index", sdk.run], ["core", core.run]] as const) {
    test(`published ${route} retains ${operation} policy across shell adapter recovery`, { timeout: 5000 }, async () => {
      const adapter = new MemoryFileSystem();
      const original = adapter.writeFile.bind(adapter);
      let effects = 0;
      let release!: () => void;
      let announce!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { announce = resolve; });
      adapter.writeFile = async (...args) => {
        effects++;
        await original(...args);
        announce();
        await wait;
      };
      const module = makeSafeJsFsModule(sdk.makeFsModule, adapter);
      const source = `import { ${operation} } from "fs"; await ${operation}("/effect", "once"); return "done";`;
      const first = sdk.run(source, { modules: { fs: module } });
      const settled = Promise.allSettled([first]);
      try {
        await started;
        const serialized = await sdk.dump(first, { mode: "replay" });
        const snapshot = JSON.parse(serialized);
        assert.ok(serialized.includes("read-side-effect"));
        assert.equal(snapshot.hostCalls.length, 1);
        const call = snapshot.hostCalls[0];
        assert.deepEqual([call.moduleId, call.operation, call.policy], ["fs", expectedOperation, "read-side-effect"]);
        await assert.rejects(recipient(source, { modules: { fs: module }, snapshot: sdk.restore(snapshot, { source }) }),
          error => error instanceof sdk.HostCallResumabilityError && error.action === "external-reconciliation");
        assert.equal(effects, 1);
        let reconciliations = 0;
        const result = await recipient(source, {
          modules: { fs: module },
          snapshot: sdk.restore(snapshot, { source }),
          hostCallResumeProvider(request: sdk.HostCallResumeRequest): sdk.HostCallResumeProof {
            reconciliations++;
            assert.equal(request.moduleId, "fs");
            assert.equal(request.operation, expectedOperation);
            assert.deepEqual(
              [request.callId, request.sourceHash, request.moduleId, request.operation, request.argumentDigest],
              [call.id, call.sourceHash, call.moduleId, call.operation, call.argumentDigest],
            );
            return { callId: request.callId, sourceHash: request.sourceHash, moduleId: request.moduleId,
              operation: request.operation, argumentDigest: request.argumentDigest,
              outcome: { status: "fulfilled", value: undefined } };
          },
        });
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.returnValue, "done");
        assert.equal(reconciliations, 1);
        const recorded = JSON.parse(await sdk.dump(result));
        const replayed = await recipient(source, { modules: { fs: module }, snapshot: sdk.restore(recorded, { source }) });
        assert.equal(replayed.ok, true);
        assert.equal(effects, 1);
        assert.equal(new TextDecoder().decode(await adapter.readFile("/effect")), "once");
      } finally {
        release();
        const [completion] = await settled;
        assert.equal(completion?.status, "fulfilled");
      }
    });
  }
}
