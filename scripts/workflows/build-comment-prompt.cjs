#!/usr/bin/env node

const { env, stderr } = process;

async function main() {
  const repo = readEnv("GITHUB_REPOSITORY");
  const token = readEnv("GITHUB_TOKEN");
  const issueNumber = Number.parseInt(readEnv("ISSUE_NUMBER"), 10);
  const commentAuthor = readEnv("COMMENT_AUTHOR");
  const commentBody = readEnvValue("COMMENT_BODY");

  if (!Number.isInteger(issueNumber)) {
    fail("ISSUE_NUMBER must be an integer.");
  }

  const [owner, repoName] = splitRepository(repo);

  const issue = await fetchIssue(owner, repoName, issueNumber, token);
  const comments = await fetchAllComments(owner, repoName, issueNumber, token);

  const lines = [];
  lines.push(`You are working on GitHub issue #${issueNumber}: ${issue.title}.`);
  lines.push("Implement the required changes and commit them.");

  const conversation = [
    {
      author: issue.user?.login ?? "unknown",
      body: issue.body ?? "",
      created_at: issue.created_at
    },
    ...comments.map((comment) => ({
      author: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      created_at: comment.created_at
    }))
  ];

  if (conversation.length > 0) {
    lines.push("");
    lines.push("Conversation:");
    for (const entry of conversation) {
      lines.push(`@${entry.author} (${formatDate(entry.created_at)}):`);
      lines.push(formatBody(entry.body));
      lines.push("");
    }
  }

  lines.push("---");
  lines.push(`Latest instruction (from @${commentAuthor}):`);
  lines.push(formatBody(commentBody));
  lines.push("---");
  lines.push("");
  lines.push(
    "Act on the latest instruction above. If code changes are needed, implement them."
  );
  lines.push(
    "If the instruction is a question, answer it based on the codebase."
  );

  process.stdout.write(lines.join("\n").trim() + "\n");
}

function readEnv(name) {
  const value = env[name];
  if (!value) {
    fail(`Missing ${name} environment variable.`);
  }
  return value;
}

function readEnvValue(name) {
  const value = env[name];
  if (value === undefined) {
    fail(`Missing ${name} environment variable.`);
  }
  return value;
}

function splitRepository(value) {
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    fail(`Invalid GITHUB_REPOSITORY value: ${value}`);
  }
  return parts;
}

async function fetchIssue(owner, repo, number, token) {
  const response = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
    token
  );
  return response.json();
}

async function fetchAllComments(owner, repo, number, token) {
  const results = [];
  let nextUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`;

  while (nextUrl) {
    const response = await githubRequest(nextUrl, token);
    const page = await response.json();
    results.push(...page);
    nextUrl = parseNextLink(response.headers.get("link"));
  }

  return results;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const parts = linkHeader.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf(";");
    if (separatorIndex < 0) {
      continue;
    }
    const urlPart = trimmed.slice(0, separatorIndex).trim();
    const relPart = trimmed.slice(separatorIndex + 1).trim();
    if (relPart !== 'rel="next"') {
      continue;
    }
    if (!urlPart.startsWith("<") || !urlPart.endsWith(">")) {
      continue;
    }
    return urlPart.slice(1, -1);
  }

  return null;
}

async function githubRequest(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "poe-code",
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    const message = await safeReadError(response);
    fail(`GitHub request failed: ${message}`);
  }

  return response;
}

async function safeReadError(response) {
  try {
    const data = await response.json();
    if (data && data.message) {
      return `${response.status} ${response.statusText}: ${data.message}`;
    }
  } catch {
    // ignore
  }
  return `${response.status} ${response.statusText}`;
}

function formatDate(value) {
  if (!value) {
    return "unknown date";
  }
  try {
    return new Date(value).toISOString();
  } catch {
    return value;
  }
}

function formatBody(value) {
  return value.trim() ? value.trim() : "_No content provided._";
}

function fail(message) {
  stderr.write(`${message}\n`);
  process.exit(1);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
