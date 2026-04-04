import { cpSync, mkdirSync } from "fs";

mkdirSync("dist/config", { recursive: true });
cpSync("src/config/default-run.yaml", "dist/config/default-run.yaml");
cpSync("src/config/default-instructions.md", "dist/config/default-instructions.md");
