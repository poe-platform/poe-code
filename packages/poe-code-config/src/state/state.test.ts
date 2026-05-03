import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createJobRegistry, type JobEntry, type StateFileSystem } from "./jobs.js";
import { createStateManager } from "./index.js";
import { createTemplateRegistry, type TemplateEntry } from "./templates.js";

function createMemFs(files: Record<string, string> = {}): StateFileSystem {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as StateFileSystem;
}

function createTemplate(hash: string, overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    hash,
    runtime_type: "docker",
    dockerfile_path: `/repo/${hash}/Dockerfile`,
    built_at: `2026-05-03T12:00:${hash.padStart(2, "0")}.000Z`,
    image: `poe-code:${hash}`,
    ...overrides
  };
}

function createJob(id: string, overrides: Partial<JobEntry> = {}): JobEntry {
  return {
    id,
    env_id: `env-${id}`,
    env_kind: "docker",
    tool: "npm",
    argv: ["run", "test"],
    cwd: "/repo",
    started_at: "2026-05-03T12:00:00.000Z",
    status: "pending",
    ...overrides
  };
}

describe("state manager", () => {
  it("loads template and job registries for the home directory", async () => {
    const fs = createMemFs();
    const state = createStateManager("/home/tester", fs);

    await state.templates.put("docker", createTemplate("alpha"));
    await state.jobs.put(createJob("job-1"));

    await expect(state.templates.get("docker", "alpha")).resolves.toMatchObject({
      hash: "alpha"
    });
    await expect(state.jobs.get("job-1")).resolves.toMatchObject({
      id: "job-1"
    });
  });
});

describe("TemplateRegistry", () => {
  it("serializes concurrent puts through the file lock", async () => {
    const fs = createMemFs();
    const registry = createTemplateRegistry("/home/tester", fs);
    const entries = Array.from({ length: 20 }, (_, index) =>
      createTemplate(String(index).padStart(2, "0"))
    );

    await Promise.all(entries.map((entry) => registry.put("docker", entry)));

    await expect(registry.list("docker")).resolves.toEqual(entries);
  });

  it("lists all backends or one backend", async () => {
    const fs = createMemFs();
    const registry = createTemplateRegistry("/home/tester", fs);
    const docker = createTemplate("docker-hash");
    const e2b = createTemplate("e2b-hash", {
      runtime_type: "e2b",
      template_id: "tpl_123",
      image: undefined
    });

    await registry.put("docker", docker);
    await registry.put("e2b", e2b);

    await expect(registry.list("docker")).resolves.toEqual([docker]);
    await expect(registry.list()).resolves.toEqual([docker, e2b]);
  });

  it("removes a template by backend and hash", async () => {
    const fs = createMemFs();
    const registry = createTemplateRegistry("/home/tester", fs);

    await registry.put("docker", createTemplate("alpha"));
    await registry.remove("docker", "alpha");

    await expect(registry.get("docker", "alpha")).resolves.toBeNull();
  });

  it("ignores persisted templates stored under a mismatched hash key", async () => {
    const templatesPath = path.join("/home/tester", ".poe-code", "state", "templates.json");
    const fs = createMemFs({
      [templatesPath]: `${JSON.stringify(
        {
          docker: {
            alpha: createTemplate("bravo")
          },
          e2b: {}
        },
        null,
        2
      )}\n`
    });
    const registry = createTemplateRegistry("/home/tester", fs);

    await expect(registry.get("docker", "alpha")).resolves.toBeNull();
    await expect(registry.list("docker")).resolves.toEqual([]);
  });
});

describe("JobRegistry", () => {
  it("serializes concurrent updates through the file lock", async () => {
    const fs = createMemFs();
    const registry = createJobRegistry("/home/tester", fs);

    await registry.put(createJob("job-1"));
    await Promise.all([
      registry.update("job-1", { status: "running" }),
      registry.update("job-1", { exit_code: 0 }),
      registry.update("job-1", { exited_at: "2026-05-03T12:01:00.000Z" }),
      registry.update("job-1", { log_file: "/logs/job-1.log" })
    ]);

    await expect(registry.get("job-1")).resolves.toEqual({
      ...createJob("job-1"),
      status: "running",
      exit_code: 0,
      exited_at: "2026-05-03T12:01:00.000Z",
      log_file: "/logs/job-1.log"
    });
  });

  it("ignores partial temp files left behind by interrupted atomic writes", async () => {
    const job = createJob("job-1", { status: "running" });
    const jobsDir = path.join("/home/tester", ".poe-code", "state", "jobs");
    const fs = createMemFs({
      [path.join(jobsDir, "job-1.json")]: `${JSON.stringify(job, null, 2)}\n`,
      [path.join(jobsDir, "job-1.json.tmp")]: "{"
    });
    const registry = createJobRegistry("/home/tester", fs);

    await expect(registry.get("job-1")).resolves.toEqual(job);
    await expect(registry.list()).resolves.toEqual([job]);
  });

  it("filters listed jobs by status, tool, env kind, and env id", async () => {
    const fs = createMemFs();
    const registry = createJobRegistry("/home/tester", fs);
    const runningNpm = createJob("running-npm", { status: "running" });
    const exitedNpm = createJob("exited-npm", {
      status: "exited",
      exit_code: 0,
      exited_at: "2026-05-03T12:01:00.000Z"
    });
    const runningNode = createJob("running-node", {
      status: "running",
      tool: "node",
      env_kind: "e2b",
      env_id: "env-special"
    });

    await registry.put(runningNpm);
    await registry.put(exitedNpm);
    await registry.put(runningNode);

    await expect(registry.list({ status: "running" })).resolves.toEqual([
      runningNode,
      runningNpm
    ]);
    await expect(registry.list({ status: "running", tool: "node" })).resolves.toEqual([
      runningNode
    ]);
    await expect(registry.list({ env_kind: "e2b", env_id: "env-special" })).resolves.toEqual([
      runningNode
    ]);
  });

  it("removes a job file", async () => {
    const fs = createMemFs();
    const registry = createJobRegistry("/home/tester", fs);

    await registry.put(createJob("job-1"));
    await registry.remove("job-1");

    await expect(registry.get("job-1")).resolves.toBeNull();
  });

  it("rejects job ids that would escape the jobs directory", async () => {
    const fs = createMemFs();
    const registry = createJobRegistry("/home/tester", fs);
    const escapedJob = createJob("../outside");

    await expect(registry.put(escapedJob)).rejects.toThrow("Invalid job id.");
    await expect(registry.get("../outside")).rejects.toThrow("Invalid job id.");
    await expect(registry.update("../outside", { status: "running" })).rejects.toThrow(
      "Invalid job id."
    );
    await expect(registry.remove("../outside")).rejects.toThrow("Invalid job id.");
  });

  it("rejects invalid job updates without corrupting the stored job", async () => {
    const fs = createMemFs();
    const registry = createJobRegistry("/home/tester", fs);
    const job = createJob("job-1");

    await registry.put(job);
    await expect(
      registry.update("job-1", { status: "finished" as JobEntry["status"] })
    ).rejects.toThrow("Invalid job entry.");

    await expect(registry.get("job-1")).resolves.toEqual(job);
  });
});
