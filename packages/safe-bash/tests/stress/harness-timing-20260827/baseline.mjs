import { readFileSync } from "node:fs";
import { run, save, snapshot } from "./evidence-tools.mjs";

save("evidence/released-marker.txt", readFileSync("/tmp/regex-production-checkpoint-closed.txt", "utf8"));
save("evidence/released-root-notes.txt", readFileSync("/tmp/harness-timing-root-notes.txt", "utf8"));
snapshot("evidence/before.json");
await run("native-version", "rg", ["--version"]);
await run("native-help", "rg", ["--help"]);
await run("baseline-jq", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "tests/commands/structured-stress/jq-grammar-author-20260827/scan-boundaries.test.ts"]);
await run("baseline-streaming", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "tests/commands/search-stress/streaming.test.ts"]);
