#!/usr/bin/env node

const { env, stderr } = process;

async function main() {
  const repo = readEnv("GITHUB_REPOSITORY");
  const token = readEnv("GITHUB_TOKEN");
  const issueNumber = Number.parseInt(readEnv("ISSUE_NUMBER"), 10);

  if (!Number.isInteger(issueNumber)) {
    fail("ISSUE_NUMBER must be an integer.");
  }

  const [owner, repoName] = splitRepository(repo);
  const issue = await fetchIssue(owner, repoName, issueNumber, token);
  const comments = await fetchAllComments(
    owner,
    repoName,
    issueNumber,
    token
  );

  process.stdout.write(buildPrompt({ issueNumber, issue, comments }));
}

function buildPrompt({ issueNumber, issue, comments }) {
  const lines = [];
  lines.push(`You are resolving GitHub issue #${issueNumber}: ${issue.title}.`);

  const modelDiscoveryInstruction = buildModelDiscoveryInstruction(issue.title ?? "");
  if (modelDiscoveryInstruction.length > 0) {
    lines.push(
      "This is a model discovery issue triggered by a Poe model changelog event."
    );
    lines.push(...modelDiscoveryInstruction);
    lines.push(
      "If updates are needed, implement the minimal required changes and commit them."
    );
    lines.push("If no updates are needed, leave the worktree unchanged.");
  } else {
    lines.push("Implement the required changes and commit them.");
  }

  const conversation = [
    {
      author: issue.user?.login ?? "unknown",
      body: issue.body ?? "",
      created_at: issue.created_at,
      kind: "issue"
    },
    ...comments.map((comment) => ({
      author: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      created_at: comment.created_at,
      kind: "comment"
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

  return lines.join("\n").trim() + "\n";
}

function buildModelDiscoveryInstruction(title) {
  if (typeof title !== "string") {
    return [];
  }

  const trimmed = title.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("new model:")) {
    const modelId = trimmed.slice("new model:".length).trim();
    if (!modelId) {
      return [];
    }
    return [
      `The Poe model changelog says a new model was added: \`${modelId}\`.`,
      "Determine whether any existing model mentions in this repository need updating because of this addition, and make the update if needed."
    ];
  }

  if (lower.startsWith("removed model:")) {
    const modelId = trimmed.slice("removed model:".length).trim();
    if (!modelId) {
      return [];
    }
    return [
      `The Poe model changelog says a model was removed: \`${modelId}\`.`,
      "Determine whether any mentions of this removed model in this repository need to be removed or replaced, and make the update if needed."
    ];
  }

  if (lower.startsWith("renamed model:")) {
    const rawRename = trimmed.slice("renamed model:".length).trim();
    const separatorIndex = rawRename.indexOf("->");
    if (separatorIndex <= 0) {
      return [];
    }
    const from = rawRename.slice(0, separatorIndex).trim();
    const to = rawRename.slice(separatorIndex + 2).trim();
    if (!from || !to) {
      return [];
    }
    return [
      `The Poe model \`${from}\` was renamed to \`${to}\`.`,
      "Determine whether any model mentions in this repository need updating because of this rename, and make the update if needed."
    ];
  }

  return [];
}

function readEnv(name) {
  const value = env[name];
  if (!value) {
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
  return await response.json();
}

async function fetchAllComments(owner, repo, number, token) {
  const results = [];
  let url = `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`;

  while (url) {
    const response = await githubRequest(url, token);
    const page = await response.json();
    results.push(...page);
    url = parseNextLink(response.headers.get("link"));
  }

  return results;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }
  const parts = linkHeader.split(",").map((part) => part.trim());
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") {
      return match[1];
    }
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

module.exports = {
  main,
  buildPrompt,
  buildModelDiscoveryInstruction
};

if (require.main === module) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
