import { fileURLToPath } from "node:url";
import { nativeAppleBinding, nativeGnuBinding, verifyNativeExecutable, type NativeGnuOptions } from "../../native-profile.js";

export function nativeSplitBinding(kind: "gnu" | "apple", options: NativeGnuOptions = {}) {
  const binding = kind === "gnu" ? nativeGnuBinding("split", options) : nativeAppleBinding("split", options);
  if (binding) {
    verifyNativeExecutable(binding, binding.path, options);
    return binding;
  }
  return kind === "gnu"
    ? { path: fileURLToPath(new URL("../metadata-stress/.oracle/coreutils-9.7/src/split", import.meta.url)), sha256: "cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958" }
    : { path: "/usr/bin/split", sha256: "7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91" };
}
