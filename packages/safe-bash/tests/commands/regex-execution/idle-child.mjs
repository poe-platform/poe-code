import { RegexExecutor } from "../../../dist/commands/regex-execution/client.js";

const executor = new RegexExecutor();
const session = executor.open(new AbortController().signal);
const descriptor = { kind: "grep", patterns: ["cat"], fixed: false, extended: true, insensitive: false, whole: false, word: false };
const result = await session.run(descriptor, [{ bytes: Buffer.from("cat"), all: false, terminated: true }]);
if (result[0][0].end !== 3) throw new Error("unexpected benign result");
console.log("idle unreferenced worker does not pin process");
