import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const message = execFileSync("git", ["log", "-1", "--format=%B"], { encoding: "utf8" });
const trailers = execFileSync("git", ["interpret-trailers", "--parse"], { input: message, encoding: "utf8" });
const workflows = [...new Set(trailers.split("\n")
  .filter(line => line.startsWith("Release: "))
  .map(line => line.slice("Release: ".length).trim()))];
const publishers = fs.readdirSync(".github/workflows").filter(name =>
  name === "release.yml" || name.startsWith("release-") && name.endsWith(".yml") && name !== "release-validation.yml");

// Validate every request before dispatching any publisher.
for (const workflow of workflows) assert.ok(publishers.includes(workflow), `Unknown release workflow: ${workflow}`);
for (const workflow of workflows) {
  execFileSync("gh", ["workflow", "run", workflow, "--ref", "main", "--repo", process.env.GITHUB_REPOSITORY], { stdio: "inherit" });
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Dispatched ${workflow} on main.\n`);
}
