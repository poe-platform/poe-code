import { readFileSync } from "node:fs";
import type { Fixture } from "./harness.js";

export const corpus = JSON.parse(readFileSync(new URL("./native-corpus.json", import.meta.url), "utf8")) as {
  provenance: { native: string; date: string; seed: string; timeoutMs: number; maxBuffer: number; shell: boolean };
  fixtures: Fixture[];
};

export const reviewed = JSON.parse(readFileSync(new URL("./reviewer-corpus.json", import.meta.url), "utf8")) as {
  fixtures: Fixture[];
};
