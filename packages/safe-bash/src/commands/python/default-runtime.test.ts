import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { Shell, agentCommands, pythonCommands } from "../../index.js";

test("defaultPythonCommands executes CPython 3.12 WASI scripts, stdin piping, and VFS writes", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/work" });
  await fs.mkdir("/work/src", { recursive: true });
  await shell.use(agentCommands({ replace: true }));
  await shell.use(pythonCommands());

  await fs.writeFile(
    "/work/src/analyzer.py",
    new TextEncoder().encode(`import sys, csv
reader = csv.DictReader(sys.stdin)
writer = csv.DictWriter(sys.stdout, fieldnames=list(reader.fieldnames) + ["health"])
writer.writeheader()
for row in reader:
    ms = float(row["latency_ms"])
    row["health"] = "CRITICAL" if ms >= 200 else ("DEGRADED" if ms >= 100 else "HEALTHY")
    writer.writerow(row)
with open("summary.txt", "w") as f:
    f.write("analyzed-ok\\n")
`)
  );

  const res = await shell.exec(`
    printf "service,latency_ms\\nedge,245.0\\nauth,19.4\\n" | python3 src/analyzer.py > analyzed.csv
    cat analyzed.csv
    cat summary.txt
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.replace(/\r\n/g, "\n"),
    "service,latency_ms,health\nedge,245.0,CRITICAL\nauth,19.4,HEALTHY\nanalyzed-ok\n"
  );
});
