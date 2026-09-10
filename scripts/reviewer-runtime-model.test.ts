import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("reviewer runtime invocation", () => {
  for (const event of ["opened", "synchronized"]) {
    for (const path of [
      `packages/github-workflows/src/workflow-templates/github-pull-request-${event}.ejected.yml`,
      `.github/workflows/gh-github-pull-request-${event}.yml`,
      `.github/workflows/poe-code-github-pull-request-${event}.yml`,
    ]) {
    it(`passes a supported default and an unchanged override in ${path}`, () => {
      const workflow = parse(readFileSync(path, "utf8"));
      const step = workflow.jobs.run.steps.find((entry: { run?: string }) => entry.run?.includes(`github-workflows github-pull-request-${event} --yes`));
      expect(step.env.POE_CODE_REVIEW_MODEL).toBe("${{ vars.POE_CODE_REVIEW_MODEL }}");
      const run = (model: string) => execFileSync("bash", ["-c", `poe-code() { printf '%s\\n' "$@"; }; ${step.run}`], {
        encoding: "utf8", env: { PATH: process.env.PATH, POE_CODE_REVIEW_MODEL: model },
      }).trim().split("\n");
      expect(run("").slice(-2)).toEqual(["--model", "gpt-5.4"]);
      expect(run("chosen-model").slice(-2)).toEqual(["--model", "chosen-model"]);
      expect(run("chosen model; literal").slice(-2)).toEqual(["--model", "chosen model; literal"]);
    });
    }
  }
});
