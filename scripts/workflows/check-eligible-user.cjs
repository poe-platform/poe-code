#!/usr/bin/env node

const { appendFileSync } = require("node:fs");

async function main() {
  const username = readEnv("USERNAME");
  const repository = readEnv("GITHUB_REPOSITORY");
  const token = readEnv("GITHUB_TOKEN");
  const outputPath = readEnv("GITHUB_OUTPUT");

  const [owner, repo] = splitRepository(repository);

  const isMember = await checkOrgMembership(owner, username, token);
  if (!isMember) {
    appendFileSync(outputPath, "allowed=false\n");
    return;
  }

  const hasWritePermission = await checkWritePermission(
    owner,
    repo,
    username,
    token
  );
  appendFileSync(
    outputPath,
    `allowed=${hasWritePermission ? "true" : "false"}\n`
  );
}

function readEnv(name) {
  const value = process.env[name];
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

async function checkOrgMembership(owner, username, token) {
  const response = await fetchWithHeaders(
    `https://api.github.com/orgs/${owner}/members/${encodeURIComponent(username)}`,
    token
  );

  if (response.status === 204) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }

  const message = await safeReadError(response);
  fail(`Failed to check org membership: ${message}`);
}

async function checkWritePermission(owner, repo, username, token) {
  const response = await fetchWithHeaders(
    `https://api.github.com/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}/permission`,
    token
  );

  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    const message = await safeReadError(response);
    fail(`Failed to check repository permission: ${message}`);
  }

  const payload = await response.json();
  const permission = readPermission(payload);
  return permission === "write" || permission === "admin";
}

function readPermission(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const permission = value.permission;
  if (typeof permission !== "string") {
    return "";
  }
  return permission.toLowerCase();
}

async function fetchWithHeaders(url, token) {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "poe-code",
      Accept: "application/vnd.github+json"
    }
  });
}

async function safeReadError(response) {
  try {
    const data = await response.json();
    if (data && data.message) {
      return `${response.status} ${response.statusText}: ${data.message}`;
    }
  } catch {
    // ignore parsing errors
  }
  return `${response.status} ${response.statusText}`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
