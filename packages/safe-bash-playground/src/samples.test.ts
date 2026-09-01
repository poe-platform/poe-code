import { describe, expect, it } from "vitest";
import { sampleFiles } from "./samples.js";

describe("sampleFiles", () => {
  it("provides editable hello programs in every requested language", () => {
    for (const extension of ["py", "js", "ts", "rs", "go", "c", "rb", "java", "sh"]) {
      expect(sampleFiles[`/home/examples/hello.${extension}`]).toContain("Hello");
    }
  });

  it("includes parseable data and an honest welcome", () => {
    expect(JSON.parse(sampleFiles["/home/data/people.json"]!)).toHaveLength(3);
    expect(sampleFiles["/home/WELCOME.md"]).toContain("source files");
    expect(sampleFiles["/home/WELCOME.md"]).toContain("not installed");
    expect(Object.keys(sampleFiles).every((path) => path.startsWith("/home/"))).toBe(true);
  });
});
