import { describe, expect, it } from "vitest";

import {
  createPendingHostCallSideEffectTag,
  resolvePendingHostCallIssuePolicy,
  resolvePendingHostCallResumePolicy,
  tagPendingHostCallAtIssue
} from "./policy.js";

describe("snapshot pending host-call policy", () => {
  it("defaults to re-issuing operations when a module does not opt out", () => {
    expect(
      resolvePendingHostCallIssuePolicy({
        id: "metric-1",
        moduleId: "metric",
        operation: "run"
      })
    ).toEqual({
      kind: "re-issue"
    });

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
