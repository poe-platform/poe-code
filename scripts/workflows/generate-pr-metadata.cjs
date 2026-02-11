#!/usr/bin/env node

const { appendFileSync } = require("node:fs");
const { execSync, spawnSync } = require("node:child_process");

function run(command, stdio = "pipe") {
  return execSync(command, { encoding: "utf8", stdio });
}

function truncate(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n...`;
}

function extractJsonCandidate(payload) {
  for (let index = 0; index < payload.length; index += 1) {
    if (payload[index] !== "{") {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let cursor = index; cursor < payload.length; cursor += 1) {
      const character = payload[cursor];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\") {
          escaped = true;
          continue;
        }
        if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }

      if (character === "{") {
        depth += 1;
        continue;
      }

      if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          return payload.slice(index, cursor + 1);
        }
        if (depth < 0) {
          break;
        }
      }
    }
  }

  return null;
}

function parseMetadata(payload) {
  const jsonCandidate = extractJsonCandidate(payload);
  if (!jsonCandidate) {
    console.error("Full payload received:", payload);
    throw new Error("Agent response did not include JSON payload.");
  }

  let metadata;
  try {
    metadata = JSON.parse(jsonCandidate);
  } catch (error) {
    console.error("Failed to parse JSON. Raw payload:");
    console.error(payload);
    console.error("\nExtracted JSON candidate:");
    console.error(jsonCandidate);
    console.error("\nJSON parse error:", error.message);
    throw new Error(`Failed to parse agent response: ${error.message}`, { cause: error });
  }

  if (!metadata || typeof metadata !== "object") {
    throw new Error("Agent response is not an object.");
  }

  const title =
    typeof metadata.title === "string" ? metadata.title.trim() : "";
  if (!title) {
    throw new Error("Agent response missing title.");
  }
  const body =
    typeof metadata.body === "string" ? metadata.body.trim() : "";
  if (!body) {
    throw new Error("Agent response missing body.");
  }

  return { title, body };
}

function main() {
  const { ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY, GITHUB_OUTPUT, MODEL, AGENT_OUTPUT } =
    process.env;

  if (!GITHUB_OUTPUT) {
    throw new Error("Missing GITHUB_OUTPUT path");
  }

  run("git fetch origin main", "inherit");

  const diffStat = run("git diff origin/main --stat").trim();
  const diffPatch = run("git diff origin/main");

  const segments = [
    ISSUE_NUMBER ? `Issue #${ISSUE_NUMBER}: ${ISSUE_TITLE ?? ""}`.trim() : null,
    ISSUE_BODY ? `Issue details:\n${ISSUE_BODY}` : null,
    AGENT_OUTPUT ? `Agent output:\n${truncate(AGENT_OUTPUT, 8_000)}` : null,
    diffStat ? `Diff summary:\n${diffStat}` : null,
    diffPatch
      ? `Full diff compared to main:\n${truncate(diffPatch, 12_000)}`
      : null
  ].filter(Boolean);

  const instructions = [
    "You generate GitHub pull request metadata.",
    "Analyze the provided issue and git diff to create appropriate PR title and body.",
    "Respond ONLY with valid JSON containing keys 'title' and 'body'.",
    "Do not include any other text, markdown formatting, or code fences.",
    "The title should be concise (under 72 characters).",
    "The body should include a summary section and reference the issue number."
  ].join(" ");

  const prompt = `${instructions}\n\n${segments.join("\n\n")}`;

  const args = ["generate", "text"];
  if (MODEL) {
    args.push("--model", MODEL);
  }
  args.push(prompt);

  // Use npx to ensure we use the locally installed version
  const result = spawnSync("npx", ["poe-code", ...args], {
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(`poe-code generate text exited with ${result.status}${suffix}`);
  }

  const metadata = parseMetadata((result.stdout || "").trim());

  appendFileSync(
    GITHUB_OUTPUT,
    `title<<EOF\n${metadata.title}\nEOF\n`
  );
  appendFileSync(
    GITHUB_OUTPUT,
    `body<<EOF\n${metadata.body}\nEOF\n`
  );
}

module.exports = {
  parseMetadata
};

if (require.main === module) {
  main();
}
