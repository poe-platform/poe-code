import { describe, expect, it } from "vitest";
import {
  editPullRequestReviewComment,
  submitPullRequestReview,
  type PullRequestReviewSubmission,
} from "./review.js";

describe("submitPullRequestReview", () => {
  it("sends the normalized comment path and body that it validates", () => {
    const calls: { command: string; args: string[]; input?: string }[] = [];
    const result = submitPullRequestReview({
      pr: "https://github.com/acme/widgets/pull/123",
      decision: "COMMENT",
      summary: "Looks good",
      comments: [{ path: " src/index.ts ", line: 12, body: "  fix this  " }],
      runner(command, args, options) {
        calls.push({ command, args, input: options?.input });
        return {
          code: 0,
          stdout: JSON.stringify({
            id: 42,
            html_url: "https://github.com/acme/widgets/pull/123#pullrequestreview-42",
          }),
          stderr: "",
        };
      },
    });

    expect(result).toEqual<PullRequestReviewSubmission>({
      id: 42,
      url: "https://github.com/acme/widgets/pull/123#pullrequestreview-42",
    });
    expect(calls[0]?.input).toBe(
      JSON.stringify({
        body: "Looks good",
        event: "COMMENT",
        comments: [{ path: "src/index.ts", line: 12, side: "RIGHT", body: "fix this" }],
      }),
    );
  });
});

describe("editPullRequestReviewComment", () => {
  it("sends the normalized body that it validates", () => {
    const calls: { command: string; args: string[]; input?: string }[] = [];
    const result = editPullRequestReviewComment({
      prUrl: "https://github.com/acme/widgets/pull/123",
      commentId: " 456 ",
      body: "  looks valid after trim  ",
      runner(command, args, options) {
        calls.push({ command, args, input: options?.input });
        return {
          code: 0,
          stdout: JSON.stringify({
            id: 456,
            html_url: "https://github.com/acme/widgets/pull/123#discussion_r456",
          }),
          stderr: "",
        };
      },
    });

    expect(result).toEqual<PullRequestReviewSubmission>({
      id: 456,
      url: "https://github.com/acme/widgets/pull/123#discussion_r456",
    });
    expect(calls[0]?.input).toBe(JSON.stringify({ body: "looks valid after trim" }));
  });
});
