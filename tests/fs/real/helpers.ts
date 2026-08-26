import assert from "node:assert/strict";
import * as native from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import type { ErrnoCode } from "../../../src/contracts/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";

export const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
export const text = (data: Uint8Array): string => new TextDecoder().decode(data);

export async function fixture(context: TestContext) {
  const temporary = await native.realpath(await native.mkdtemp(join(tmpdir(), "virtual-bash-real-")));
  context.after(() => native.rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, "root");
  const outside = join(temporary, "root-other");
  await native.mkdir(root);
  await native.mkdir(outside);
  await native.writeFile(join(outside, "secret"), "outside-secret");
  const filesystem = await createRealFileSystem({ root });
  return { temporary, root, outside, filesystem };
}

export function errno(code: ErrnoCode, path?: string, syscall?: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(typeof error.errno, "number");
    assert.ok(error.errno < 0);
    if (path !== undefined) assert.equal(error.path, path);
    if (syscall !== undefined) assert.equal(error.syscall, syscall);
    return true;
  };
}
