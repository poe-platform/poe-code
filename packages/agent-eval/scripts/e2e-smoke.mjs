import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.EVAL_E2E !== "1") {
  console.log("skipped");
  process.exit(0);
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
process.chdir(packageRoot);

const { runEval } = await import("../dist/index.js");

const agent = resolveAgent();
const outDir = await mkdtemp(path.join(tmpdir(), "agent-eval-e2e-"));
const result = await runEval({
  sourceDir: path.join(packageRoot, "src", "__fixtures__", "e2e-source"),
  evalId: "hello-file",
  agent,
  model: "anthropic/claude-haiku-4-5-20251001",
  outDir,
  cloneCacheDir: null,
  verifyOracle: false,
  judge: "off"
});

const resultJsonPath = path.join(outDir, result.runId, "result.json");
const resultJson = await readFile(resultJsonPath, "utf8");
const allowedVerdicts = new Set(["pass", "fail", "budget_exceeded"]);

console.log(resultJson);

if (!allowedVerdicts.has(result.verdict)) {
  throw new Error(`Unexpected eval verdict "${result.verdict}".\n${resultJson}`);
}

function resolveAgent() {
  const candidates = [
    { agent: "claude-code", binary: "claude" },
    { agent: "codex", binary: "codex" },
    { agent: "opencode", binary: "opencode" }
  ];
  const found = candidates.find((candidate) => commandExists(candidate.binary));

  if (found === undefined) {
    throw new Error(
      `No supported agent CLI found on PATH. Tried: ${candidates
        .map((candidate) => candidate.binary)
        .join(", ")}.`
    );
  }

  return found.agent;
}

function commandExists(command) {
  const result = spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", command], {
    stdio: "ignore"
  });
  return result.status === 0;
}
