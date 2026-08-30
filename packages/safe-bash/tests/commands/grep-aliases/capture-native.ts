import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { captureProfile, directory } from "./native-support.js";

const [profile, bin, filename] = process.argv.slice(2);
if ((profile !== "bsd" && profile !== "gnu") || !bin || !filename || resolve(directory, filename) !== join(directory, filename) || filename.includes("/")) {
  throw new Error("usage: capture-native.ts bsd|gnu /absolute/bin output.json (owned directory only)");
}
const evidence = await captureProfile(profile, bin);
await writeFile(join(directory, filename), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ profile, cases: evidence.observations.length, cleanup: evidence.cleanup }));
