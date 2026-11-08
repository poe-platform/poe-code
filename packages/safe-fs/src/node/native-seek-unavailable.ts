import { FsError } from "../contracts/errors.js";

// Workers support native file reads, but cannot load the optional Node addon.
export async function loadBinding(): Promise<never> {
  throw new FsError("ENOTSUP", { message: "Native seek is unavailable in Workers" });
}
