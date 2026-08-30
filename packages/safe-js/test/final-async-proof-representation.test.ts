import { describe, expect, it } from "vitest";
import {
  callbackSources,
  exerciseCallbackProof,
  nativeCallback
} from "./fixtures/final-async-proof.js";

describe("public reconstructed callback result proofs", () => {
  it("anchors the unchanged benign function source natively", async () => {
    expect(await nativeCallback(callbackSources.function)).toEqual({
      same: true,
      calls: 1,
      value: 7
    });
  });

  it("recovers a joined data proof without starting another callback", async () => {
    const evidence = await exerciseCallbackProof("data");
    console.log(JSON.stringify(evidence));
    expect(evidence.original).toEqual(evidence.native);
    expect(evidence.resumed).toEqual(evidence.native);
    expect(evidence.callbackInvocations).toBe(1);
    expect(evidence.replayedCallbackIds).toHaveLength(1);
    expect(evidence.consumed).toBe(true);
  });

  it("preserves a returned source function and its aliases through a public proof", async () => {
    const evidence = await exerciseCallbackProof("function");
    console.log(JSON.stringify(evidence));
    expect(evidence.original).toEqual(evidence.native);
    expect(evidence.resumed).toEqual(evidence.native);
    expect(evidence.callbackInvocations).toBe(1);
    expect(evidence.replayedCallbackIds).toHaveLength(1);
    expect(evidence.consumed).toBe(true);
  });
});
