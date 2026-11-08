#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

function readEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

function run(spawn, command, args, extraEnv = {}) {
  const result = spawn(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv }
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    const suffix = message ? `: ${message}` : "";
    throw new Error(`${command} exited with ${result.status}${suffix}`);
  }
  return result.stdout.trim();
}

function main() {
  runWithSpawn(spawnSync);
}

function runWithSpawn(spawn) {
  readEnv("GITHUB_REPOSITORY");
  readEnv("GITHUB_TOKEN");
  readEnv("ISSUE_NUMBER");

  const service = process.env.SERVICE || "claude-code";
  const prompt = run(spawn, "node", ["scripts/workflows/build-issue-prompt.cjs"]);
  run(spawn, "poe-code", ["spawn", service, prompt], { OUTPUT_FORMAT: "json" });
}

module.exports = {
  main,
  runWithSpawn
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
