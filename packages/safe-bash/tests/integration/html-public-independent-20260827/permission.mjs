import { readFileSync } from "node:fs";
try {
  const bytes = readFileSync(process.argv[2]);
  console.log(`PERMISSION_CONTROL_READ:${bytes.toString()}`);
} catch (error) {
  if (error.code !== "ERR_ACCESS_DENIED" || error.permission !== "FileSystemRead") throw error;
  console.error("BOUNDARY:PERMISSION_DENIED:FileSystemRead");
  process.exitCode = 17;
}
