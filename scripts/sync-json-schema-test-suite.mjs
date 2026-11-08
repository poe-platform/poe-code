import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const suiteCommit = "92acb61eb772a932c077d5ffa634ded719d2d738";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(
  repoRoot,
  "packages/toolcraft-schema/test/json-schema-test-suite"
);
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "json-schema-test-suite-"));
const checkoutDirectory = path.join(temporaryDirectory, "checkout");

function trimLineEndWhitespace(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      trimLineEndWhitespace(entryPath);
    } else if (entry.name.endsWith(".json")) {
      const content = readFileSync(entryPath, "utf8");
      writeFileSync(
        entryPath,
        content
          .split("\n")
          .map((line) => line.trimEnd())
          .join("\n"),
        "utf8"
      );
    }
  }
}

try {
  execFileSync(
    "git",
    [
      "clone",
      "--filter=blob:none",
      "https://github.com/json-schema-org/JSON-Schema-Test-Suite.git",
      checkoutDirectory
    ],
    { stdio: "inherit" }
  );
  execFileSync("git", ["checkout", suiteCommit], {
    cwd: checkoutDirectory,
    stdio: "inherit"
  });

  rmSync(outputDirectory, { recursive: true, force: true });
  cpSync(
    path.join(checkoutDirectory, "tests", "draft2020-12"),
    path.join(outputDirectory, "tests", "draft2020-12"),
    {
      recursive: true,
      filter: (source) =>
        path.basename(source) !== "optional" && !source.includes(`${path.sep}optional${path.sep}`)
    }
  );
  cpSync(
    path.join(checkoutDirectory, "tests", "draft7"),
    path.join(outputDirectory, "tests", "draft7"),
    {
      recursive: true,
      filter: (source) =>
        path.basename(source) !== "optional" && !source.includes(`${path.sep}optional${path.sep}`)
    }
  );
  cpSync(path.join(checkoutDirectory, "remotes"), path.join(outputDirectory, "remotes"), {
    recursive: true
  });
  trimLineEndWhitespace(outputDirectory);
  cpSync(path.join(checkoutDirectory, "LICENSE"), path.join(outputDirectory, "LICENSE"));
  writeFileSync(path.join(outputDirectory, "COMMIT"), `${suiteCommit}\n`, "utf8");

  const recordedCommit = readFileSync(path.join(outputDirectory, "COMMIT"), "utf8").trim();
  if (recordedCommit !== suiteCommit) {
    throw new Error("JSON Schema Test Suite commit record did not match the pinned commit.");
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
