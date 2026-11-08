import { describe, expect, it } from "vitest";

import {
  createPendingHostCallSideEffectTag,
  HostOperationResumePolicyError,
  registerPendingHostCallPolicy,
  readRegisteredPendingHostCallPolicy,
  resolvePendingHostCallIssuePolicy,
  resolvePendingHostCallResumePolicy,
  pendingHostCallResumeIdentityMatches,
  tagPendingHostCallAtIssue
} from "./policy.js";

describe("snapshot pending host-call policy", () => {
  it.each([
    "checkpoint",
    "commit",
    "diff",
    "head",
    "revert",
    "worktreeCreate",
    "worktreeList",
    "worktreeRemove"
  ])("removes Git default replay policy for %s", (operation) => {
    expect(readRegisteredPendingHostCallPolicy("git", operation)).toBeUndefined();
    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "removed-git-operation",
        moduleId: "git",
        operation
      })
    ).toThrow(HostOperationResumePolicyError);
  });

  it("matches every external resume identity field", () => {
    const identity = {
      argumentDigest: "args",
      callId: "run:1",
      moduleId: "payments",
      operation: "charge",
      sourceHash: "source"
    };

    expect(pendingHostCallResumeIdentityMatches(identity, identity)).toBe(true);
    for (const key of Object.keys(identity) as Array<keyof typeof identity>) {
      expect(
        pendingHostCallResumeIdentityMatches(identity, {
          ...identity,
          [key]: "wrong"
        })
      ).toBe(false);
    }
  });

  it("returns the read-side-effect decision for a known read-on-resume operation", () => {
    expect(
      resolvePendingHostCallIssuePolicy({
        id: "agent-commit-1",
        moduleId: "agent",
        operation: "spawn"
      })
    ).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "agent-commit-1",
        moduleId: "agent",
        operation: "spawn"
      }
    });
  });

  it("returns the re-issue decision for a known idempotent operation", () => {
    registerPendingHostCallPolicy({
      moduleId: "policy-reader",
      operation: "head",
      policy: "re-issue"
    });
    expect(
      resolvePendingHostCallIssuePolicy({
        id: "agent-head-1",
        moduleId: "policy-reader",
        operation: "head"
      })
    ).toEqual({
      kind: "re-issue"
    });
  });

  it("throws a typed error for an operation without a declared policy", () => {
    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "unknown-1",
        moduleId: "payments",
        operation: "charge"
      })
    ).toThrowError(HostOperationResumePolicyError);

    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "unknown-1",
        moduleId: "payments",
        operation: "charge"
      })
    ).toThrowError(
      "Host operation payments.charge has no resume policy; declare 're-issue' (idempotent) or 'read-side-effect' (effectful)."
    );
  });

  it("rejects an unregistered operation even when the snapshot has a side-effect tag", () => {
    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "payments-charge-tagged-1",
        moduleId: "payments",
        operation: "charge",
        sideEffectTag: {
          kind: "host-call-side-effect",
          callId: "payments-charge-tagged-1",
          moduleId: "payments",
          operation: "charge"
        }
      })
    ).toThrowError(HostOperationResumePolicyError);
  });

  it("treats whitespace-only module ids and operations as unknown", () => {
    expect(
      resolvePendingHostCallIssuePolicy({
        id: "blank-module-1",
        moduleId: "   ",
        operation: "spawn"
      })
    ).toEqual({
      kind: "re-issue"
    });

    expect(
      resolvePendingHostCallIssuePolicy({
        id: "blank-operation-1",
        moduleId: "agent",
        operation: "   "
      })
    ).toEqual({
      kind: "re-issue"
    });
  });

  it("matches module ids and operations case-sensitively", () => {
    expect(() =>
      resolvePendingHostCallIssuePolicy({
        id: "agent-capital-commit-1",
        moduleId: "agent",
        operation: "Spawn"
      })
    ).toThrowError(HostOperationResumePolicyError);

    expect(
      resolvePendingHostCallIssuePolicy({
        id: "agent-lowercase-commit-1",
        moduleId: "agent",
        operation: "spawn"
      }).kind
    ).toBe("read-side-effect");
  });

  it("uses policies registered at runtime", () => {
    registerPendingHostCallPolicy({
      moduleId: "custom",
      operation: "writeOnce",
      policy: "read-side-effect"
    });

    expect(
      resolvePendingHostCallIssuePolicy({
        id: "custom-write-once-1",
        moduleId: "custom",
        operation: "writeOnce"
      })
    ).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "custom-write-once-1",
        moduleId: "custom",
        operation: "writeOnce"
      }
    });
  });

  it("registers __proto__ modules without mutating Object.prototype", () => {
    const operation = "agentScriptPrototypePolicyRegression";

    try {
      registerPendingHostCallPolicy({
        moduleId: "__proto__",
        operation,
        policy: "read-side-effect"
      });

      expect((Object.prototype as Record<string, unknown>)[operation]).toBeUndefined();
      expect(
        resolvePendingHostCallIssuePolicy({
          id: "proto-policy-1",
          moduleId: "__proto__",
          operation
        }).kind
      ).toBe("read-side-effect");
    } finally {
      delete (Object.prototype as Record<string, unknown>)[operation];
    }
  });

  it("resolves registered re-issue operations", () => {
    registerPendingHostCallPolicy({
      moduleId: "policy-reader",
      operation: "head",
      policy: "re-issue"
    });
    expect(
      resolvePendingHostCallResumePolicy({
        id: "agent-1",
        moduleId: "policy-reader",
        operation: "head"
      })
    ).toEqual({
      kind: "re-issue"
    });
  });

  it("treats opted-out operations as read-side-effect even when descriptors need trimming", () => {
    expect(
      resolvePendingHostCallIssuePolicy({
        id: "agent-checkpoint-1",
        moduleId: " agent ",
        operation: " spawn "
      })
    ).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "agent-checkpoint-1",
        moduleId: "agent",
        operation: "spawn"
      }
    });

    expect(
      resolvePendingHostCallIssuePolicy({
        id: "agent-revert-1",
        moduleId: "agent",
        operation: "spawn"
      })
    ).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "agent-revert-1",
        moduleId: "agent",
        operation: "spawn"
      }
    });
  });

  it("tags agent calls at issue time so resume reads the side effect", () => {
    const tagged = tagPendingHostCallAtIssue({
      id: "agent-commit-1",
      moduleId: "agent",
      operation: "spawn",
      args: {
        message: "save progress"
      }
    });

    expect(tagged).toEqual({
      id: "agent-commit-1",
      moduleId: "agent",
      operation: "spawn",
      args: {
        message: "save progress"
      },
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "agent-commit-1",
        moduleId: "agent",
        operation: "spawn"
      }
    });
    expect(resolvePendingHostCallResumePolicy(tagged)).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "agent-commit-1",
        moduleId: "agent",
        operation: "spawn"
      }
    });
  });

  it("tags agent spawns at issue time so resume can read completed results", () => {
    const tagged = tagPendingHostCallAtIssue({
      id: 42,
      moduleId: "agent",
      operation: "spawn"
    });

    expect(tagged.sideEffectTag).toEqual({
      kind: "host-call-side-effect",
      callId: "42",
      moduleId: "agent",
      operation: "spawn"
    });
    expect(resolvePendingHostCallResumePolicy(tagged)).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "42",
        moduleId: "agent",
        operation: "spawn"
      }
    });
  });

  it("preserves an existing side-effect tag during resume resolution", () => {
    const sideEffectTag = createPendingHostCallSideEffectTag({
      id: "agent-7",
      moduleId: "agent",
      operation: "spawn"
    });

    expect(
      resolvePendingHostCallResumePolicy({
        id: "agent-7",
        moduleId: "agent",
        operation: "spawn",
        sideEffectTag
      })
    ).toEqual({
      kind: "read-side-effect",
      sideEffectTag
    });
  });

  it("rejects persisted side-effect tags that do not match the pending host call", () => {
    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "agent-7",
        moduleId: "agent",
        operation: "spawn",
        sideEffectTag: {
          kind: "host-call-side-effect",
          callId: "other-call",
          moduleId: "agent",
          operation: "spawn"
        }
      })
    ).toThrowError("Pending host call side-effect tag callId must match the pending host call id.");

    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "agent-7",
        moduleId: "agent",
        operation: "spawn",
        sideEffectTag: {
          kind: "host-call-side-effect",
          callId: "agent-7",
          moduleId: "git",
          operation: "commit"
        }
      })
    ).toThrowError(
      "Pending host call side-effect tag moduleId and operation must match the pending host call."
    );
  });

  it("rejects malformed persisted side-effect tags", () => {
    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "agent-spawn-1",
        moduleId: "agent",
        operation: "spawn",
        sideEffectTag: {
          kind: "host-call-side-effect",
          callId: "   ",
          moduleId: "agent",
          operation: "spawn"
        }
      })
    ).toThrowError("Pending host call side-effect tag callId must be a non-empty string.");
  });
});
