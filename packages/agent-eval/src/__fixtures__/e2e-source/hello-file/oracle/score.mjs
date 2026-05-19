import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const helloPath = path.join(process.env.CLONE_DIR, "hello.txt");
let content = "";

try {
  content = await readFile(helloPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

await writeFile(
  path.join(process.env.CLONE_DIR, ".scorer-result.json"),
  JSON.stringify({
    passed: content.includes("hello") ? 1 : 0,
    total: 1
  })
);
