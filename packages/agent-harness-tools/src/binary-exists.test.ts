import { describe, expect, it } from "vitest";
import { createBinaryExistsDetectors } from "./binary-exists.js";

describe("createBinaryExistsDetectors", () => {
  it("passes the binary name as an argument to the shell fallback", () => {
    const binaryName = 'missing"; printf pwned; #';
    const shellDetector = createBinaryExistsDetectors(binaryName)[2];

    expect(shellDetector).toMatchObject({
      command: "sh",
      args: ["-c", expect.not.stringContaining(binaryName), "sh", binaryName]
    });
    expect(shellDetector?.args[1]).toContain('"$directory/$1"');
  });
});
