import { describe, expect, it } from "vitest";

import {
  createPendingHostCallSideEffectTag,
  HostOperationResumePolicyError,
  registerPendingHostCallPolicy,
  resolvePendingHostCallIssuePolicy,
  resolvePendingHostCallResumePolicy,
  pendingHostCallResumeIdentityMatches,
  tagPendingHostCallAtIssue
} from "./policy.js";

describe("snapshot pending host-call policy", () => {
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
        id: "git-commit-1",
        moduleId: "git",
        operation: "commit"
      })
    ).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "git-commit-1",
        moduleId: "git",
        operation: "commit"
      }
    });
  });

  it("returns the re-issue decision for a known idempotent operation", () => {
    expect(
      resolvePendingHostCallIssuePolicy({
        id: "git-head-1",
        moduleId: "git",
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
        operation: "commit"
      })
    ).toEqual({
      kind: "re-issue"
    });

    expect(
      resolvePendingHostCallIssuePolicy({
        id: "blank-operation-1",
        moduleId: "git",
        operation: "   "
      })
    ).toEqual({
      kind: "re-issue"
    });
  });

  it("matches module ids and operations case-sensitively", () => {
    expect(() =>
      resolvePendingHostCallIssuePolicy({
        id: "git-capital-commit-1",
        moduleId: "git",
        operation: "Commit"
      })
    ).toThrowError(HostOperationResumePolicyError);

    expect(
      resolvePendingHostCallIssuePolicy({
        id: "git-lowercase-commit-1",
        moduleId: "git",
        operation: "commit"
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
    expect(
      resolvePendingHostCallResumePolicy({
        id: "git-1",
        moduleId: "git",
        operation: "head"
      })
    ).toEqual({
      kind: "re-issue"
    });
  });

  it("treats opted-out operations as read-side-effect even when descriptors need trimming", () => {
    expect(
      resolvePendingHostCallIssuePolicy({
        id: "git-checkpoint-1",
        moduleId: " git ",
        operation: " checkpoint "
      })
    ).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "git-checkpoint-1",
        moduleId: "git",
        operation: "checkpoint"
      }
    });

    expect(
      resolvePendingHostCallIssuePolicy({
        id: "git-revert-1",
        moduleId: "git",
        operation: "revert"
      })
    ).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "git-revert-1",
        moduleId: "git",
        operation: "revert"
      }
    });
  });

  it("tags git commit calls at issue time so resume reads the side effect", () => {
    const tagged = tagPendingHostCallAtIssue({
      id: "git-commit-1",
      moduleId: "git",
      operation: "commit",
      args: {
        message: "save progress"
      }
    });

    expect(tagged).toEqual({
      id: "git-commit-1",
      moduleId: "git",
      operation: "commit",
      args: {
        message: "save progress"
      },
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "git-commit-1",
        moduleId: "git",
        operation: "commit"
      }
    });
    expect(resolvePendingHostCallResumePolicy(tagged)).toEqual({
      kind: "read-side-effect",
      sideEffectTag: {
        kind: "host-call-side-effect",
        callId: "git-commit-1",
        moduleId: "git",
        operation: "commit"
      }
    });
  });

  it("tags git worktree mutations at issue time", () => {
    expect(
      tagPendingHostCallAtIssue({
        id: "git-worktree-create-1",
        moduleId: "git",
        operation: "worktreeCreate"
      }).sideEffectTag
    ).toEqual({
      kind: "host-call-side-effect",
      callId: "git-worktree-create-1",
      moduleId: "git",
      operation: "worktreeCreate"
    });

    expect(
      tagPendingHostCallAtIssue({
        id: "git-worktree-remove-1",
        moduleId: "git",
        operation: "worktreeRemove"
      }).sideEffectTag
    ).toEqual({
      kind: "host-call-side-effect",
      callId: "git-worktree-remove-1",
      moduleId: "git",
      operation: "worktreeRemove"
    });

    expect(
      tagPendingHostCallAtIssue({
        id: "git-worktree-list-1",
        moduleId: "git",
        operation: "worktreeList"
      })
    ).toEqual({
      id: "git-worktree-list-1",
      moduleId: "git",
      operation: "worktreeList"
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
        id: "git-commit-1",
        moduleId: "git",
        operation: "commit",
        sideEffectTag: {
          kind: "host-call-side-effect",
          callId: "   ",
          moduleId: "git",
          operation: "commit"
        }
      })
    ).toThrowError("Pending host call side-effect tag callId must be a non-empty string.");
  });
});
