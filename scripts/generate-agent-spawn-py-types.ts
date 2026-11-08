import { runAgentSpawnPythonTypeCodegen } from "../src/codegen/agent-spawn-py-types.js";

const check = process.argv.includes("--check");

await runAgentSpawnPythonTypeCodegen({ check });
