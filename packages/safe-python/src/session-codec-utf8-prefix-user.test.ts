import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecUtf8PrefixUserSource} from "./codec-utf8-prefix-user-cases.js";
import reference from "./runtime/__snapshots__/codec-utf8-prefix-user-oracle.json";

it.each(["normal", "cancel-return", "cancel-throw"] as const)("replays UTF-8 prefix state and guest recovery through services: %s", mode => {
  expect(codecUtf8PrefixUserSource).toBe(reference.source);
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.status).toBe(0);
  expect(reference.stderr).toBe("");
  const controller = new AbortController();
  let output = "", reads = 0, writes = 0, flushes = 0;
  const session = new PythonSession({
    limits: {maxSteps: 10000000, maxAllocatedBytes: 64000000, maxDepth: 100},
    hashSeed: [1n, 2n],
    signal: controller.signal,
    input: {readLine() {
      reads++;
      if (mode !== "normal") controller.abort();
      if (mode === "cancel-throw") throw Error("input failed after cancellation");
      return "continue\n";
    }},
    output: {write(text) {writes++; output += text;}, flush() {flushes++;}}
  });
  const result = session.exec(codecUtf8PrefixUserSource, {filename: "<string>"});
  if (mode === "normal") {
    expect(result.status).toBe("ok");
    expect(output).toBe(reference.stdout);
    expect(reads).toBe(4);
  } else {
    expect(result).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
    expect(reads).toBe(1);
    expect(output).toBe(reference.stdout.slice(0, reference.stdout.indexOf("resume: input continue") + "resume: ".length));
    const counts = [reads, writes, flushes];
    expect(session.exec("print('unreachable')")).toEqual(result);
    expect(session.eval("input()")).toEqual(result);
    expect([reads, writes, flushes]).toEqual(counts);
  }
});
