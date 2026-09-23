import { register } from "tsx/esm/api";

register();
await import("./agent-worker.ts");
