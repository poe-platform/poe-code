import test from "node:test";
import { compareNative } from "./helpers.js";

test("sed numeric ranges expire when n consumes their final addressed line", () => compareNative("sed", {
  args: ["-n", "2,3{n;p;}"], stdin: "1\n2\n3\n4\n5\n",
}));

test("sed negated numeric ranges resume after N passes their endpoint", () => compareNative("sed", {
  args: ["-n", "1,2{N;p;};1,2!p"], stdin: "1\n2\n3\n4\n",
}));

test("sed numeric ranges do not remain selected after a branch skips evaluation", () => compareNative("sed", {
  args: ["-n", "2b next\n1,2p\n:next"], stdin: "1\n2\n3\n",
}));
