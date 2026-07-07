import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const suiteCommit = "1eb27ab4462b9e5819dc47db99044f5fd1fa9bc7";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(repoRoot, "packages/tiny-stdio-mcp-server/test/uritemplate-test");
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "uritemplate-test-"));
const checkoutDirectory = path.join(temporaryDirectory, "checkout");
const fixtureNames = [
  "spec-examples.json",
  "spec-examples-by-section.json",
  "extended-tests.json",
  "negative-tests.json",
  "LICENSE"
];

try {
  execFileSync(
    "git",
    [
      "clone",
      "--filter=blob:none",
      "https://github.com/uri-templates/uritemplate-test.git",
      checkoutDirectory
    ],
    { stdio: "inherit" }
  );
  execFileSync("git", ["checkout", suiteCommit], {
    cwd: checkoutDirectory,
    stdio: "inherit"
  });

  rmSync(outputDirectory, { recursive: true, force: true });
  for (const fixtureName of fixtureNames) {
    cpSync(path.join(checkoutDirectory, fixtureName), path.join(outputDirectory, fixtureName));
  }
  writeFileSync(path.join(outputDirectory, "COMMIT"), `${suiteCommit}\n`, "utf8");

  const recordedCommit = readFileSync(path.join(outputDirectory, "COMMIT"), "utf8").trim();
  if (recordedCommit !== suiteCommit) {
    throw new Error("URI Template test suite commit record did not match the pinned commit.");
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
