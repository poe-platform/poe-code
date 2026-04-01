import { execSync } from "node:child_process";

function extractJson(output) {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{")) {
      return JSON.parse(line);
    }
  }
  throw new Error("No JSON found in vitest output");
}

try {
  const output = execSync("npx vitest run --reporter=json 2>/dev/null", {
    encoding: "utf8",
    timeout: 120_000,
  });

  const json = extractJson(output);
  const durationMs = json.testResults.reduce(
    (sum, r) => sum + (r.endTime - r.startTime),
    0
  );
  console.log(durationMs);
} catch (error) {
  if (error.stdout) {
    try {
      const json = extractJson(error.stdout);
      const durationMs = json.testResults.reduce(
        (sum, r) => sum + (r.endTime - r.startTime),
        0
      );
      console.log(durationMs);
    } catch {
      console.log(999999);
      process.exit(1);
    }
  } else {
    console.log(999999);
    process.exit(1);
  }
}
