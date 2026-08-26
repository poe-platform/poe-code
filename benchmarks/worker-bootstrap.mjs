import { register } from "tsx/esm/api";

register();
await import("./worker.ts");
