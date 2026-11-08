import { describe, expect, it } from "vitest";
import { fetchReviewHistory, type ReviewHistoryComment } from "./review-history.js";

function ghResponse(body: unknown) {
  return {
    code: 0,
    stdout: `HTTP/2.0 200 OK\nx-ratelimit-remaining: 5000\n\n${JSON.stringify(body)}`,
    stderr: "",
  };
}

async function collectHistory(options: Parameters<typeof fetchReviewHistory>[0]) {
  const comments: ReviewHistoryComment[] = [];
  for await (const comment of fetchReviewHistory(options)) {
    comments.push(comment);
  }
  return comments;
}

describe("fetchReviewHistory", () => {
  it("dedupes repositories case-insensitively", async () => {
    const calls: string[] = [];
    const comments = await collectHistory({
      username: "alice",
      repos: ["owner/repo", "Owner/Repo"],
      maxComments: 2,
      runner(_command, args) {
        const endpoint = args[2] ?? "";
        calls.push(endpoint);
        if (endpoint.includes("/pulls/comments")) {
          return ghResponse([
            {
              user: { login: "alice" },
              created_at: "2026-01-01T00:00:00Z",
              body: "Please fix",
              pull_request_url: "https://api.github.com/repos/owner/repo/pulls/1",
              path: "src/a.ts",
              line: 10,
              diff_hunk: "@@",
            },
          ]);
        }
        if (endpoint.endsWith("/pulls/1")) {
          return ghResponse({
            number: 1,
            title: "Demo PR",
            html_url: "https://github.com/owner/repo/pull/1",
          });
        }
        if (endpoint.includes("/pulls?") || endpoint.includes("/issues/comments")) {
          return ghResponse([]);
        }
        throw new Error(endpoint);
      },
    });

    expect(comments.map((comment) => `${comment.repo}#${comment.pullRequestNumber}:${comment.body}`)).toEqual([
      "owner/repo#1:Please fix",
    ]);
    expect(calls).toHaveLength(4);
  });

  it("rejects malformed GitHub timestamps", async () => {
    await expect(
      collectHistory({
        username: "octo",
        repos: ["acme/widgets"],
        runner(_command, args) {
          const endpoint = args[2] ?? "";
          if (endpoint.includes("/pulls/comments")) {
            return ghResponse([
              {
                user: { login: "octo" },
                body: "bad timestamp",
                created_at: "not-a-date",
                pull_request_url: "https://api.github.com/repos/acme/widgets/pulls/7",
                path: "src/a.ts",
                line: 3,
              },
            ]);
          }
          if (endpoint.endsWith("/pulls/7")) {
            return ghResponse({
              number: 7,
              title: "Fix",
              html_url: "https://github.com/acme/widgets/pull/7",
            });
          }
          if (endpoint.includes("/pulls?") || endpoint.includes("/issues/comments")) {
            return ghResponse([]);
          }
          throw new Error(endpoint);
        },
      }),
    ).rejects.toThrow("Invalid GitHub review-history review_comment timestamp");
  });
});
