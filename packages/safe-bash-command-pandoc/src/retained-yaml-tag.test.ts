import {expect, it} from "vitest";
import {parseDocument} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";
import {resolveRetainedYamlTag} from "./retained-yaml-tag.js";

async function fixture(tag: string, run: (source: RetainedSourceText) => Promise<void>) {
  const fs = new MemoryFileSystem(), storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const source = new RetainedSourceText(storage, async () => {}); await source.append([tag]);
  try {await run(source);} finally {await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
}
it.each([
  ["!", "str"], ["!!str", "str"], ["!!%73tr", "str"], ["!<tag:yaml.org,2002:str>", "str"],
  ["!!int", "int"], ["!!bool", "bool"], ["!!float", "float"], ["!!null", "null"], ["!!map", "map"], ["!!seq", "seq"],
  ["!!binary", "binary"], ["!!timestamp", "timestamp"], ["!!merge", "merge"], ["!!omap", "omap"], ["!!pairs", "pairs"], ["!!set", "set"],
  ["!local", "unknown"], ["!%FF", "unknown"], ["!!%F0%9F%98%80", "unknown"], ["!!%EF%BB%BFstr", "unknown"],
  ["!<tag:yaml.org,2002:%73tr>", "unknown"], ["!<>", "implicit"], ["!<unknown>", "unknown"]
])("resolves %s without materializing its name", async (tag, expected) => {
  await fixture(tag!, async source => {
    const doc = parseDocument(`${tag} value`);
    // Known special tags may reject this scalar value; tag-name resolution itself must succeed.
    expect(doc.errors.filter(error => error.message.includes("Could not resolve tag") || error.message.includes("URI malformed"))).toEqual([]);
    expect(await resolveRetainedYamlTag(source, {start: 0, end: source.length}, async () => {})).toBe(expected);
  });
});
it.each(["!!", "!custom!value", "!a!b!value", "!!%FF", "!!%C3%28", "!!%ED%A0%80", "!!%F4%90%80%80", "!!%C0%AF", "!!%E2", "!!%E2literal", "!<!>", "!<!!>", "!<unterminated"])("rejects invalid tag %s like the current parser", async tag => {
  expect(parseDocument(`${tag} value`).errors.length).toBeGreaterThan(0);
  await fixture(tag, async source => {await expect(resolveRetainedYamlTag(source, {start: 0, end: source.length}, async () => {})).rejects.toBeInstanceOf(RetainedYamlSyntaxError);});
});
it("validates long URI suffixes with bounded decode windows", async () => {
  for (const tag of ["!!" + "%C3%A9".repeat(12000), "!<" + "x".repeat(65536) + ">", "!" + "x".repeat(65536)]) {
    await fixture(tag, async source => {
      source.chunks = () => {throw new Error("Tag names must not be collected");};
      expect(await resolveRetainedYamlTag(source, {start: 0, end: source.length}, async () => {})).toBe("unknown");
    });
  }
});
it("validates malformed suffixes after an already-unrecognized prefix", async () => {
  const tag = "!!" + "x".repeat(65536) + "%FF";
  await fixture(tag, async source => {await expect(resolveRetainedYamlTag(source, {start: 0, end: source.length}, async () => {})).rejects.toBeInstanceOf(RetainedYamlSyntaxError);});
});
it("cooperates during long tag validation", async () => {
  await fixture("!!" + "x".repeat(65536), async source => {
    const reason = new Error("cancelled"); let calls = 0;
    await expect(resolveRetainedYamlTag(source, {start: 0, end: source.length}, async () => {if (++calls === 4) throw reason;})).rejects.toBe(reason);
  });
});

it("decodes UTF-8 sequences split across the fixed URI window", async () => {
  for (const suffix of ["%E2%82%AC", "%F0%9F%98%80", "%C3%A9"]) {
    await fixture("!!" + "%41".repeat(511) + suffix, async source => {
      expect(await resolveRetainedYamlTag(source, {start: 0, end: source.length}, async () => {})).toBe("unknown");
    });
  }
});
it("propagates tag source-read failures without classifying them as syntax", async () => {
  await fixture("!!str", async source => {
    const reason = new Error("backing unavailable"); source.unit = async () => {throw reason;};
    await expect(resolveRetainedYamlTag(source, {start: 0, end: source.length}, async () => {})).rejects.toBe(reason);
  });
});
