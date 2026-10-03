import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";
import type {CommandContext} from "safe-bash-contracts";

async function fixture(shebang: string) {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/filter", new TextEncoder().encode(`${shebang}\n${"# padding\n".repeat(100)}`));
  const invoke = vi.fn<NonNullable<CommandContext["invoke"]>>(async (_name, _args, options) => {
    for await (const bytes of options!.stdin!) await options!.stdout!.write(bytes);
    return {exitCode: 0};
  });
  const context: CommandContext = {
    command: "pandoc", args: ["-fcommonmark", "-tplain", "--filter", "./filter"],
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {yield new TextEncoder().encode("Hello");})(),
    stdout: {write: vi.fn(async () => {})}, stderr: {write: vi.fn(async () => {})}, invoke
  };
  return {fs, invoke, context};
}

it.each([["#!/usr/bin/env python3", "python3"], ["#!/usr/bin/env node", "node"], ["#!/bin/bash", "bash"]])("detects %s in an extensionless filter larger than 256 bytes", async (shebang, interpreter) => {
  const {context, invoke} = await fixture(shebang);
  expect(await createPandocCommand({}, name => name === interpreter).execute(context)).toEqual({exitCode: 0});
  expect(invoke).toHaveBeenCalledWith(interpreter, ["--", "/./filter", "plain"], expect.anything());
});

it("propagates AbortError from interpreter detection without capability diagnostics", async () => {
  const {context, fs, invoke} = await fixture("#!/usr/bin/env node");
  const error = new DOMException("Read cancelled", "AbortError");
  vi.spyOn(fs, "readStream").mockImplementation(async function* () {yield new Uint8Array(); throw error;});
  await expect(createPandocCommand({}, name => name === "node").execute(context)).rejects.toBe(error);
  expect(invoke).not.toHaveBeenCalled();
  expect(context.stderr.write).not.toHaveBeenCalled();
});

it.each([{resourceBytes: 256}, {inputBytes: 256}])("respects configured filter read limits: %j", async limits => {
  const {context, invoke} = await fixture("#!/usr/bin/env node");
  expect(await createPandocCommand({limits}, name => name === "node").execute(context)).toEqual({exitCode: 3});
  expect(invoke).not.toHaveBeenCalled();
});

it("preserves the caller's cancellation reason during interpreter detection", async () => {
  const {context, fs, invoke} = await fixture("#!/usr/bin/env node");
  const controller = new AbortController();
  const reason = new Error("Caller cancelled filter read");
  vi.spyOn(fs, "readStream").mockImplementation(async function* () {
    yield new Uint8Array();
    controller.abort(reason);
    throw reason;
  });
  await expect(createPandocCommand({}, name => name === "node").execute({...context, signal: controller.signal})).rejects.toBe(reason);
  expect(invoke).not.toHaveBeenCalled();
});


it("detects an interpreter from reused chunks without collecting the script", async () => {
  const {context, fs, invoke} = await fixture("#!/usr/bin/env node");
  const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole script reads forbidden"));
  let closed = 0, yielded = 0;
  vi.spyOn(fs, "readStream").mockImplementation(async function* () {
    try {
      yield new TextEncoder().encode("#!/usr/bin/");
      yield new TextEncoder().encode("env node\n");
      const reused = new Uint8Array(16384);
      for (let i = 0; i < 64; i++) {reused.fill(32); yielded += reused.length; yield reused;}
    } finally {closed++;}
  });
  expect(await createPandocCommand({}, name => name === "node").execute(context)).toEqual({exitCode: 0});
  expect(invoke).toHaveBeenCalledOnce();
  expect(readFile).not.toHaveBeenCalled();
  expect(closed).toBeGreaterThan(0);
  expect(yielded).toBe(closed * 1048576);
});


it("closes a filter source on budget failure and rejects late read errors", async () => {
  for (const limited of [false, true]) {
    const {context, fs, invoke} = await fixture("#!/usr/bin/env node");
    let closed = false;
    vi.spyOn(fs, "readStream").mockImplementation(async function* () {
      try {
        yield new TextEncoder().encode("#!/usr/bin/env node\n");
        yield new Uint8Array(16384);
        throw new Error("Late script read failure");
      } finally {closed = true;}
    });
    expect(await createPandocCommand(limited ? {limits: {resourceBytes: 256}} : {}, name => name === "node").execute(context)).toEqual({exitCode: 3});
    expect(invoke).not.toHaveBeenCalled();
    expect(closed).toBe(true);
  }
});
