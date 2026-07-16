import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createJobRegistry, type JobEntry, type StateFileSystem } from "./jobs.js";
import { createStateManager } from "./index.js";
import { createTemplateRegistry, type TemplateEntry } from "./templates.js";

function createMemFs(files: Record<string, string> = {}): StateFileSystem {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as StateFileSystem;
}

function symlink(fs: StateFileSystem, target: string, linkPath: string): Promise<void> {
  return (fs as StateFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
    target,
    linkPath
  );
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

async function withLegacyTempName<Result>(operation: () => Promise<Result>): Promise<Result> {
  const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1_234);
  const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

  try {
    return await operation();
  } finally {
    dateSpy.mockRestore();
    randomSpy.mockRestore();
  }
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
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
  it("preserves concurrent puts", async () => {
    const fs = createMemFs();
    const registry = createTemplateRegistry("/home/tester", fs);
    const entries = Array.from({ length: 20 }, (_, index) =>
      createTemplate(String(index).padStart(2, "0"))
    );

    await Promise.all(entries.map((entry) => registry.put("docker", entry)));

    await expect(registry.list("docker")).resolves.toEqual(entries);
  });

  it("lists Docker templates with or without an explicit backend", async () => {
    const fs = createMemFs();
    const registry = createTemplateRegistry("/home/tester", fs);
    const docker = createTemplate("docker-hash");

    await registry.put("docker", docker);

    await expect(registry.list("docker")).resolves.toEqual([docker]);
    await expect(registry.list()).resolves.toEqual([docker]);
  });

  it("removes a template by backend and hash", async () => {
    const fs = createMemFs();
    const registry = createTemplateRegistry("/home/tester", fs);

    await registry.put("docker", createTemplate("alpha"));
    await registry.remove("docker", "alpha");

    await expect(registry.get("docker", "alpha")).resolves.toBeNull();
  });

  it("preserves stored templates when an interrupted write rejects", async () => {
    const templatesPath = path.join("/home/tester", ".poe-code", "state", "templates.json");
    const original = createTemplate("alpha");
    const base = createMemFs({
      [templatesPath]: `${JSON.stringify({ docker: { alpha: original } }, null, 2)}\n`
    });
    let tempPath: string | undefined;
    const fs: StateFileSystem = {
      ...base,
      async writeFile(targetPath, data, options) {
        if (targetPath === templatesPath || targetPath.includes(".tmp")) {
          if (targetPath.includes(".tmp")) {
            tempPath = targetPath;
          }
          await base.writeFile(targetPath, "{", options);
          throw new Error("templates disk full");
        }
        await base.writeFile(targetPath, data, options);
      }
    };
    const registry = createTemplateRegistry("/home/tester", fs);

    await expect(registry.put("docker", createTemplate("bravo"))).rejects.toThrow(
      "templates disk full"
    );
    await expect(
      createTemplateRegistry("/home/tester", base).get("docker", "alpha")
    ).resolves.toEqual(original);
    expect(tempPath).toBeDefined();
    await expect(base.readFile(tempPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not treat inherited lstat error codes as missing template state paths", async () => {
    const templatesPath = path.join("/home/tester", ".poe-code", "state", "templates.json");
    const base = createMemFs();
    await base.mkdir(path.dirname(templatesPath), { recursive: true });
    const fs: StateFileSystem = {
      ...base,
      async lstat(targetPath) {
        if (targetPath === templatesPath) {
          throw new Error("template state lstat denied");
        }

        return base.lstat!(targetPath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(createTemplateRegistry("/home/tester", fs).list()).rejects.toThrow(
        "template state lstat denied"
      );
    });
  });

  it("removes partial template temp files after inherited existing-path errors", async () => {
    const templatesPath = path.join("/home/tester", ".poe-code", "state", "templates.json");
    const base = createMemFs();
    let tempPath: string | undefined;
    const fs: StateFileSystem = {
      ...base,
      async writeFile(targetPath, data, options) {
        if (targetPath.startsWith(`${templatesPath}.`) && targetPath.endsWith(".tmp")) {
          tempPath = targetPath;
          await base.writeFile(targetPath, "{", options);
          throw new Error("template temp exists");
        }

        await base.writeFile(targetPath, data, options);
      }
    };

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(
        createTemplateRegistry("/home/tester", fs).put("docker", createTemplate("bravo"))
      ).rejects.toThrow("template temp exists");
    });

    expect(tempPath).toBeDefined();
    await expect(base.readFile(tempPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("ignores persisted templates stored under a mismatched hash key", async () => {
    const templatesPath = path.join("/home/tester", ".poe-code", "state", "templates.json");
    const fs = createMemFs({
      [templatesPath]: `${JSON.stringify(
        {
          docker: {
            alpha: createTemplate("bravo")
          },
        },
        null,
        2
      )}\n`
    });
    const registry = createTemplateRegistry("/home/tester", fs);

    await expect(registry.get("docker", "alpha")).resolves.toBeNull();
    await expect(registry.list("docker")).resolves.toEqual([]);
  });

  it("stores template hashes that match object prototype property names", async () => {
    const fs = createMemFs();
    const registry = createTemplateRegistry("/home/tester", fs);
    const proto = createTemplate("__proto__");

    await expect(registry.get("docker", "toString")).resolves.toBeNull();
    await registry.put("docker", proto);

    await expect(registry.get("docker", "__proto__")).resolves.toEqual(proto);
    await expect(registry.list("docker")).resolves.toEqual([proto]);
  });

  it("rejects reads and writes through a symlinked template state file", async () => {
    const templatesPath = path.join("/home/tester", ".poe-code", "state", "templates.json");
    const outsidePath = "/outside/templates.json";
    const volume = Volume.fromJSON(
      {
        [outsidePath]: `${JSON.stringify({ docker: {} }, null, 2)}\n`
      },
      "/"
    );
    volume.mkdirSync(path.dirname(templatesPath), { recursive: true });
    volume.symlinkSync(outsidePath, templatesPath);
    const fs = createFsFromVolume(volume).promises as unknown as StateFileSystem;
    const registry = createTemplateRegistry("/home/tester", fs);

    await expect(registry.list("docker")).rejects.toThrow(
      "Refusing template state access through symbolic link"
    );
    await expect(registry.put("docker", createTemplate("alpha"))).rejects.toThrow(
      "Refusing template state access through symbolic link"
    );
  });

  it("rejects reads and writes through a symlinked runtime state directory", async () => {
    const stateDir = path.join("/home/tester", ".poe-code", "state");
    const outsideDir = "/outside/state";
    const outsidePath = path.join(outsideDir, "templates.json");
    const fs = createMemFs({
      [outsidePath]: `${JSON.stringify({ docker: {} }, null, 2)}\n`
    });
    await fs.mkdir(path.dirname(stateDir), { recursive: true });
    await symlink(fs, outsideDir, stateDir);
    const registry = createTemplateRegistry("/home/tester", fs);

    await expect(registry.list("docker")).rejects.toThrow(
      "Refusing template state access through symbolic link"
    );
    await expect(registry.put("docker", createTemplate("alpha"))).rejects.toThrow(
      "Refusing template state access through symbolic link"
    );
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toContain('"docker"');
  });

  it("does not follow a preexisting legacy template temp path symlink", async () => {
    await withLegacyTempName(async () => {
      const templatesPath = path.join("/home/tester", ".poe-code", "state", "templates.json");
      const outsidePath = "/outside/templates-tmp.json";
      const legacyTempPath = `${templatesPath}.${process.pid}.1234.i.tmp`;
      const volume = Volume.fromJSON({ [outsidePath]: "outside-state\n" }, "/");
      volume.mkdirSync(path.dirname(templatesPath), { recursive: true });
      volume.symlinkSync(outsidePath, legacyTempPath);
      const fs = createFsFromVolume(volume).promises as unknown as StateFileSystem;
      const registry = createTemplateRegistry("/home/tester", fs);
      const template = createTemplate("alpha");

      await registry.put("docker", template);

      await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside-state\n");
      const stateStat = await fs.lstat?.(templatesPath);
      expect(stateStat?.isSymbolicLink()).toBe(false);
      await expect(registry.get("docker", "alpha")).resolves.toEqual(template);
    });
  });

  it("does not remove a colliding template temp symlink it did not create", async () => {
    const templatesPath = path.join("/home/tester", ".poe-code", "state", "templates.json");
    const outsidePath = "/outside/templates-tmp.json";
    const original = createTemplate("alpha");
    const volume = Volume.fromJSON(
      {
        [templatesPath]: `${JSON.stringify({ docker: { alpha: original } }, null, 2)}\n`,
        [outsidePath]: "outside-state\n"
      },
      "/"
    );
    const base = createFsFromVolume(volume).promises as unknown as StateFileSystem;
    let tempPath: string | undefined;
    const fs: StateFileSystem = {
      ...base,
      async writeFile(targetPath, data, options) {
        if (
          tempPath === undefined &&
          targetPath.startsWith(`${templatesPath}.`) &&
          targetPath.endsWith(".tmp")
        ) {
          tempPath = targetPath;
          volume.symlinkSync(outsidePath, targetPath);
        }

        await base.writeFile(targetPath, data, options);
      }
    };
    const registry = createTemplateRegistry("/home/tester", fs);

    await expect(registry.put("docker", createTemplate("bravo"))).rejects.toMatchObject({
      code: "EEXIST"
    });

    expect(tempPath).toBeDefined();
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside-state\n");
    const tempStat = await fs.lstat?.(tempPath as string);
    expect(tempStat?.isSymbolicLink()).toBe(true);
    await expect(
      createTemplateRegistry("/home/tester", base).get("docker", "alpha")
    ).resolves.toEqual(original);
  });
});

describe("JobRegistry", () => {
  it("persists runtime reattach context with a job", async () => {
    const fs = createMemFs();
    const registry = createJobRegistry("/home/tester", fs);

    await registry.put(
      createJob("job-1", {
        reattach_context: { engine: "docker", context: "colima-profile" }
      })
    );

    await expect(registry.get("job-1")).resolves.toMatchObject({
      reattach_context: { engine: "docker", context: "colima-profile" }
    });
  });

  it("preserves concurrent updates", async () => {
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

  it("preserves the stored job when a partial temp write fails", async () => {
    const job = createJob("job-1", { status: "running" });
    const jobsDir = path.join("/home/tester", ".poe-code", "state", "jobs");
    const jobPath = path.join(jobsDir, "job-1.json");
    const base = createMemFs({
      [jobPath]: `${JSON.stringify(job, null, 2)}\n`
    });
    let tempPath: string | undefined;
    const fs: StateFileSystem = {
      ...base,
      async writeFile(targetPath, data, options) {
        if (targetPath.startsWith(`${jobPath}.`) && targetPath.endsWith(".tmp")) {
          tempPath = targetPath;
          await base.writeFile(targetPath, "{", options);
          throw new Error("jobs disk full");
        }
        await base.writeFile(targetPath, data, options);
      }
    };

    await expect(createJobRegistry("/home/tester", fs).update("job-1", {
      status: "exited"
    })).rejects.toThrow("jobs disk full");

    await expect(createJobRegistry("/home/tester", base).get("job-1")).resolves.toEqual(job);
    expect(tempPath).toBeDefined();
    await expect(base.readFile(tempPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("removes partial job temp files after inherited existing-path errors", async () => {
    const jobsDir = path.join("/home/tester", ".poe-code", "state", "jobs");
    const jobPath = path.join(jobsDir, "job-1.json");
    const base = createMemFs();
    let tempPath: string | undefined;
    const fs: StateFileSystem = {
      ...base,
      async writeFile(targetPath, data, options) {
        if (targetPath.startsWith(`${jobPath}.`) && targetPath.endsWith(".tmp")) {
          tempPath = targetPath;
          await base.writeFile(targetPath, "{", options);
          throw new Error("job temp exists");
        }

        await base.writeFile(targetPath, data, options);
      }
    };

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(createJobRegistry("/home/tester", fs).put(createJob("job-1"))).rejects.toThrow(
        "job temp exists"
      );
    });

    expect(tempPath).toBeDefined();
    await expect(base.readFile(tempPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("preserves rename failures when temporary cleanup also rejects", async () => {
    const base = createMemFs();
    const fs: StateFileSystem = {
      ...base,
      async rename() {
        throw new Error("rename offline");
      },
      async unlink(filePath) {
        if (filePath.includes(".tmp")) {
          throw new Error("temp cleanup denied");
        }
        await base.unlink(filePath);
      }
    };

    await expect(createJobRegistry("/home/tester", fs).put(createJob("job-1"))).rejects.toThrow(
      "rename offline"
    );
  });

  it("ignores job records whose id does not match their filename", async () => {
    const jobsDir = path.join("/home/tester", ".poe-code", "state", "jobs");
    const fs = createMemFs({
      [path.join(jobsDir, "requested-job.json")]:
        `${JSON.stringify(createJob("other-job"), null, 2)}\n`
    });
    const registry = createJobRegistry("/home/tester", fs);

    await expect(registry.get("requested-job")).resolves.toBeNull();
    await expect(registry.list()).resolves.toEqual([]);
  });

  it("rejects non-finite job exit codes before persisting them", async () => {
    const fs = createMemFs();
    const registry = createJobRegistry("/home/tester", fs);

    await expect(
      registry.put(createJob("job-1", { exit_code: Number.POSITIVE_INFINITY }))
    ).rejects.toThrow("Invalid job entry.");
    await expect(registry.put(createJob("job-2", { exit_code: 1.5 }))).rejects.toThrow(
      "Invalid job entry."
    );
    await expect(registry.get("job-1")).resolves.toBeNull();
    await expect(registry.get("job-2")).resolves.toBeNull();
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
      env_kind: "docker",
      env_id: "env-special"
    });

    await registry.put(runningNpm);
    await registry.put(exitedNpm);
    await registry.put(runningNode);

    await expect(registry.list({ status: "running" })).resolves.toEqual([runningNode, runningNpm]);
    await expect(registry.list({ status: "running", tool: "node" })).resolves.toEqual([
      runningNode
    ]);
    await expect(registry.list({ env_kind: "docker", env_id: "env-special" })).resolves.toEqual([
      runningNode
    ]);
  });

  it("lists the newest jobs first and caps them with a limit", async () => {
    const fs = createMemFs();
    const registry = createJobRegistry("/home/tester", fs);
    const stale = createJob("stale", { started_at: "2026-05-03T12:00:00.000Z" });
    const recent = createJob("recent", { started_at: "2026-07-10T12:00:00.000Z" });
    const newest = createJob("newest", { started_at: "2026-07-14T12:00:00.000Z" });

    await registry.put(stale);
    await registry.put(recent);
    await registry.put(newest);

    await expect(registry.list()).resolves.toEqual([newest, recent, stale]);
    await expect(registry.list({ limit: 2 })).resolves.toEqual([newest, recent]);
  });

  it("drops jobs started before a since window but keeps unknown start times", async () => {
    const fs = createMemFs();
    const registry = createJobRegistry("/home/tester", fs);
    const stale = createJob("stale", { started_at: "2026-05-03T12:00:00.000Z" });
    const recent = createJob("recent", { started_at: "2026-07-14T12:00:00.000Z" });
    const unstarted = createJob("unstarted", { started_at: "", status: "pending" });

    await registry.put(stale);
    await registry.put(recent);
    await registry.put(unstarted);

    await expect(
      registry.list({ since: new Date("2026-07-01T00:00:00.000Z") })
    ).resolves.toEqual([recent, unstarted]);
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

  it("rejects reads, writes, and removals through a symlinked jobs directory", async () => {
    const jobsDir = path.join("/home/tester", ".poe-code", "state", "jobs");
    const outsideDir = "/outside/jobs";
    const vol = Volume.fromJSON(
      {
        [path.join(outsideDir, "external.json")]:
          `${JSON.stringify(createJob("external"), null, 2)}\n`
      },
      "/"
    );
    const fs = createFsFromVolume(vol).promises as unknown as StateFileSystem;
    vol.mkdirSync(path.dirname(jobsDir), { recursive: true });
    vol.symlinkSync(outsideDir, jobsDir);
    const registry = createJobRegistry("/home/tester", fs);

    await expect(registry.put(createJob("job-1"))).rejects.toThrow(
      "Refusing runtime job state access through symbolic link"
    );
    await expect(registry.list()).rejects.toThrow(
      "Refusing runtime job state access through symbolic link"
    );
    await expect(registry.remove("external")).rejects.toThrow(
      "Refusing runtime job state access through symbolic link"
    );
    await expect(fs.readFile(path.join(outsideDir, "external.json"), "utf8")).resolves.toContain(
      '"id": "external"'
    );
  });

  it("rejects reads and writes through a symlinked runtime state directory", async () => {
    const stateDir = path.join("/home/tester", ".poe-code", "state");
    const outsideJobsDir = "/outside/state/jobs";
    const fs = createMemFs({
      [path.join(outsideJobsDir, "external.json")]:
        `${JSON.stringify(createJob("external"), null, 2)}\n`
    });
    await fs.mkdir(path.dirname(stateDir), { recursive: true });
    await symlink(fs, "/outside/state", stateDir);
    const registry = createJobRegistry("/home/tester", fs);

    await expect(registry.list()).rejects.toThrow(
      "Refusing runtime job state access through symbolic link"
    );
    await expect(registry.put(createJob("job-1"))).rejects.toThrow(
      "Refusing runtime job state access through symbolic link"
    );
    await expect(registry.remove("external")).rejects.toThrow(
      "Refusing runtime job state access through symbolic link"
    );
    await expect(
      fs.readFile(path.join(outsideJobsDir, "external.json"), "utf8")
    ).resolves.toContain('"id": "external"');
  });

  it("rejects reads through a symlinked job state file", async () => {
    const jobsDir = path.join("/home/tester", ".poe-code", "state", "jobs");
    const outsidePath = "/outside/job-1.json";
    const fs = createMemFs({
      [outsidePath]: `${JSON.stringify(createJob("job-1"), null, 2)}\n`
    });
    await fs.mkdir(jobsDir, { recursive: true });
    await symlink(fs, outsidePath, path.join(jobsDir, "job-1.json"));
    const registry = createJobRegistry("/home/tester", fs);

    await expect(registry.get("job-1")).rejects.toThrow(
      "Refusing runtime job state access through symbolic link"
    );
    await expect(registry.list()).rejects.toThrow(
      "Refusing runtime job state access through symbolic link"
    );
  });

  it("does not follow a preexisting legacy job temp path symlink", async () => {
    await withLegacyTempName(async () => {
      const jobsDir = path.join("/home/tester", ".poe-code", "state", "jobs");
      const jobPath = path.join(jobsDir, "job-1.json");
      const outsidePath = "/outside/job-tmp.json";
      const legacyTempPath = `${jobPath}.${process.pid}.1234.i.tmp`;
      const volume = Volume.fromJSON({ [outsidePath]: "outside-job\n" }, "/");
      volume.mkdirSync(jobsDir, { recursive: true });
      volume.symlinkSync(outsidePath, legacyTempPath);
      const fs = createFsFromVolume(volume).promises as unknown as StateFileSystem;
      const registry = createJobRegistry("/home/tester", fs);
      const job = createJob("job-1");

      await registry.put(job);

      await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside-job\n");
      const jobStat = await fs.lstat?.(jobPath);
      expect(jobStat?.isSymbolicLink()).toBe(false);
      await expect(registry.get("job-1")).resolves.toEqual(job);
    });
  });

  it("does not remove a colliding job temp symlink it did not create", async () => {
    const jobsDir = path.join("/home/tester", ".poe-code", "state", "jobs");
    const jobPath = path.join(jobsDir, "job-1.json");
    const outsidePath = "/outside/job-tmp.json";
    const volume = Volume.fromJSON({ [outsidePath]: "outside-job\n" }, "/");
    volume.mkdirSync(jobsDir, { recursive: true });
    const base = createFsFromVolume(volume).promises as unknown as StateFileSystem;
    let tempPath: string | undefined;
    const fs: StateFileSystem = {
      ...base,
      async writeFile(targetPath, data, options) {
        if (
          tempPath === undefined &&
          targetPath.startsWith(`${jobPath}.`) &&
          targetPath.endsWith(".tmp")
        ) {
          tempPath = targetPath;
          volume.symlinkSync(outsidePath, targetPath);
        }

        await base.writeFile(targetPath, data, options);
      }
    };

    await expect(
      createJobRegistry("/home/tester", fs).put(createJob("job-1"))
    ).rejects.toMatchObject({
      code: "EEXIST"
    });

    expect(tempPath).toBeDefined();
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside-job\n");
    const tempStat = await fs.lstat?.(tempPath as string);
    expect(tempStat?.isSymbolicLink()).toBe(true);
    await expect(createJobRegistry("/home/tester", base).get("job-1")).resolves.toBeNull();
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
