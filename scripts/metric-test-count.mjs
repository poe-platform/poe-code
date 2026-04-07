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
    maxBuffer: 32 * 1024 * 1024,
  });

  const json = extractJson(output);
  console.log(json.numPassedTests ?? 0);
} catch (error) {
  if (error.stdout) {
    try {
      const json = extractJson(error.stdout);
      console.log(json.numPassedTests ?? 0);
    } catch {
      console.log(0);
      process.exit(1);
    }
  } else {
    console.log(0);
    process.exit(1);
  }
}
