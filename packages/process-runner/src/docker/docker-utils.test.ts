import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import type { DockerRunArgs } from "../types.js";
import { buildDockerEnvArgs, buildDockerRunArgs } from "./args.js";
import { detectEngine, isEngineAvailable } from "./engine.js";
import { buildContextArgs, detectContext } from "./context.js";
import { serializeDockerEnvFile } from "./env-file.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn()
}));

// === args.test.ts ===

const baseInput: DockerRunArgs = {
  engine: "docker",
  context: null,
  image: "node:22",
  command: "node",
  args: [],
  mounts: [],
  ports: [],
  containerName: "process-runner-test",
  detached: false,
  interactive: false,
  tty: false,
  rm: true,
  extraArgs: []
};

describe("buildDockerRunArgs", () => {
  it("builds minimal docker run args", () => {
    expect(buildDockerRunArgs(baseInput)).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "node:22",
      "node"
    ]);
  });

  it("builds mount args with absolute source paths and readonly suffix", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        mounts: [
          {
            source: "./workspace",
            target: "/app"
          },
          {
            source: "../readonly",
            target: "/readonly",
            readonly: true
          }
        ]
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "-v",
      `${path.resolve("./workspace")}:/app`,
      "-v",
      `${path.resolve("../readonly")}:/readonly:ro`,
      "node:22",
      "node"
    ]);
  });

  it("builds port mapping args", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        ports: [
          {
            host: 8080,
            container: 3000
          }
        ]
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "-p",
      "8080:3000",
      "node:22",
      "node"
    ]);
  });

  it("omits the tcp suffix and includes non-tcp protocols", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        ports: [
          {
            host: 8080,
            container: 3000,
            protocol: "tcp"
          },
          {
            host: 5353,
            container: 5353,
            protocol: "udp"
          }
        ]
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "-p",
      "8080:3000",
      "-p",
      "5353:5353/udp",
      "node:22",
      "node"
    ]);
  });

  it("rejects invalid Docker port mappings before serializing run args", () => {
    const invalidPorts = [
      [{ host: -1, container: 3000 }],
      [{ host: 3000.5, container: 80 }],
      [{ host: 3000, container: 0 }],
      [{ host: 3000, container: 80, protocol: "icmp" }]
    ];

    for (const ports of invalidPorts) {
      expect(() => {
        buildDockerRunArgs({
          ...baseInput,
          ports: ports as DockerRunArgs["ports"]
        });
      }).toThrow(/port/i);
    }
  });

  it("builds env args for each entry", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        env: {
          FOO: "bar",
          HELLO: "world"
        }
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "-e",
      "FOO",
      "-e",
      "HELLO",
      "node:22",
      "node"
    ]);
  });

  it("uses an env file when the caller provides one", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        env: {
          SECRET_TOKEN: "sk-secret"
        },
        envFilePath: "/tmp/poe-docker-env/env"
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "--env-file",
      "/tmp/poe-docker-env/env",
      "node:22",
      "node"
    ]);
  });

  it("keeps env values out of docker run argv", () => {
    const args = buildDockerRunArgs({
      ...baseInput,
      env: {
        SECRET_TOKEN: "sk-secret"
      }
    });

    expect(args).toContain("SECRET_TOKEN");
    expect(args.join("\0")).not.toContain("sk-secret");
  });

  it("adds network args when configured", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        network: "mynet"
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "--network",
      "mynet",
      "node:22",
      "node"
    ]);
  });

  it("adds docker context args when configured", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        context: "colima"
      })
    ).toEqual([
      "docker",
      "--context",
      "colima",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "node:22",
      "node"
    ]);
  });

  it("does not add context args for podman", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        engine: "podman",
        context: "colima"
      })
    ).toEqual([
      "podman",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "node:22",
      "node"
    ]);
  });

  it("does not add context args for an empty docker context", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        context: ""
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "node:22",
      "node"
    ]);
  });

  it("adds detached mode flag", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        detached: true
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "-d",
      "--name",
      "process-runner-test",
      "node:22",
      "node"
    ]);
  });

  it("adds interactive mode flag", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        interactive: true
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "-i",
      "--name",
      "process-runner-test",
      "node:22",
      "node"
    ]);
  });

  it("adds tty mode flag", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        tty: true
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "-t",
      "--name",
      "process-runner-test",
      "node:22",
      "node"
    ]);
  });

  it("adds interactive and tty flags together", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        interactive: true,
        tty: true
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "-i",
      "-t",
      "--name",
      "process-runner-test",
      "node:22",
      "node"
    ]);
  });

  it("passes extra args before the image", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        extraArgs: ["--pull=never", "--user", "1000:1000"]
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "--pull=never",
      "--user",
      "1000:1000",
      "node:22",
      "node"
    ]);
  });

  it("adds cwd with working directory flag", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        cwd: "/some/path"
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "-w",
      "/some/path",
      "node:22",
      "node"
    ]);
  });

  it("appends command args after image and command", () => {
    expect(
      buildDockerRunArgs({
        ...baseInput,
        command: "npm",
        args: ["run", "dev"]
      })
    ).toEqual([
      "docker",
      "run",
      "--rm",
      "--name",
      "process-runner-test",
      "node:22",
      "npm",
      "run",
      "dev"
    ]);
  });

  it("keeps the documented full argument order for a mixed spec", () => {
    expect(
      buildDockerRunArgs({
        engine: "docker",
        context: "colima",
        image: "node:22",
        command: "npm",
        args: ["run", "dev"],
        cwd: "/workspace",
        env: {
          FOO: "bar"
        },
        mounts: [
          {
            source: "./workspace",
            target: "/app",
            readonly: true
          }
        ],
        ports: [
          {
            host: 8080,
            container: 3000,
            protocol: "udp"
          }
        ],
        network: "mynet",
        containerName: "process-runner-test",
        detached: true,
        interactive: true,
        tty: true,
        rm: true,
        extraArgs: ["--user", "1000:1000"]
      })
    ).toEqual([
      "docker",
      "--context",
      "colima",
      "run",
      "--rm",
      "-d",
      "-i",
      "-t",
      "--name",
      "process-runner-test",
      "-w",
      "/workspace",
      "-e",
      "FOO",
      "-v",
      `${path.resolve("./workspace")}:/app:ro`,
      "-p",
      "8080:3000/udp",
      "--network",
      "mynet",
      "--user",
      "1000:1000",
      "node:22",
      "npm",
      "run",
      "dev"
    ]);
  });

  it("does not mutate the input arrays", () => {
    const input: DockerRunArgs = {
      ...baseInput,
      args: ["run", "dev"],
      mounts: [
        {
          source: "./workspace",
          target: "/app"
        }
      ],
      ports: [
        {
          host: 8080,
          container: 3000
        }
      ],
      extraArgs: ["--user", "1000:1000"]
    };

    const snapshot = structuredClone(input);

    buildDockerRunArgs(input);

    expect(input).toEqual(snapshot);
  });
});

describe("buildDockerEnvArgs", () => {
  it("returns no args when no environment is configured", () => {
    expect(buildDockerEnvArgs({ env: undefined })).toEqual([]);
    expect(buildDockerEnvArgs({ env: {} })).toEqual([]);
  });
});

describe("serializeDockerEnvFile", () => {
  it("writes Docker env-file entries", () => {
    expect(serializeDockerEnvFile([["FOO", "bar"], ["HELLO", "world"]])).toBe(
      "FOO=bar\nHELLO=world\n"
    );
  });

  it("rejects entries that cannot be represented safely in Docker env files", () => {
    expect(() => serializeDockerEnvFile([["BAD=KEY", "value"]])).toThrow(
      "Invalid Docker environment variable name"
    );
    expect(() => serializeDockerEnvFile([["SECRET", "line one\nline two"]])).toThrow(
      "Docker env-file values cannot contain newline characters."
    );
  });
});

// === engine.test.ts ===

describe("detectEngine", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('returns "docker" when docker is available', () => {
    vi.mocked(execSync).mockImplementation((command) => {
      if (command === "docker --version") {
        return Buffer.from("");
      }

      throw new Error("not found");
    });

    expect(detectEngine()).toBe("docker");
    expect(execSync).toHaveBeenCalledWith("docker --version", {
      stdio: "ignore"
    });
  });

  it('returns "podman" when only podman is available', () => {
    vi.mocked(execSync).mockImplementation((command) => {
      if (command === "podman --version") {
        return Buffer.from("");
      }

      throw new Error("not found");
    });

    expect(detectEngine()).toBe("podman");
    expect(execSync).toHaveBeenNthCalledWith(1, "docker --version", {
      stdio: "ignore"
    });
    expect(execSync).toHaveBeenNthCalledWith(2, "podman --version", {
      stdio: "ignore"
    });
  });

  it("throws a descriptive error when neither engine is available", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });

    expect(() => detectEngine()).toThrowError(
      "No container engine found. Please install Docker or Podman:\n" +
        "  - Docker Desktop: https://www.docker.com/products/docker-desktop\n" +
        "  - Colima (macOS): brew install colima && colima start\n" +
        "  - Podman: https://podman.io/docs/installation"
    );
  });
});

describe("isEngineAvailable", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it("returns true when the engine CLI is available", () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));

    expect(isEngineAvailable("docker")).toBe(true);
    expect(execSync).toHaveBeenCalledWith("docker --version", {
      stdio: "ignore"
    });
  });

  it("returns false when the engine CLI is unavailable", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });

    expect(isEngineAvailable("podman")).toBe(false);
    expect(execSync).toHaveBeenCalledWith("podman --version", {
      stdio: "ignore"
    });
  });
});

// === context.test.ts ===

describe("detectContext", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('returns "colima" for the default running profile', () => {
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Running","runtime":"docker"}\n'
    );

    expect(detectContext()).toBe("colima");
  });

  it('returns "colima-myprofile" for a named profile', () => {
    vi.mocked(execSync).mockReturnValue(
      '{"name":"myprofile","status":"Running","runtime":"docker"}\n'
    );

    expect(detectContext()).toBe("colima-myprofile");
  });

  it('uses the profile field when name is missing', () => {
    vi.mocked(execSync).mockReturnValue(
      '{"profile":"myprofile","status":"Running","runtime":"docker"}\n'
    );

    expect(detectContext()).toBe("colima-myprofile");
  });

  it("returns null when colima is not installed", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("command not found");
    });

    expect(detectContext()).toBeNull();
  });

  it("returns null when no Docker runtime is running", () => {
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Stopped","runtime":"docker"}\n' +
        '{"name":"k8s","status":"Running","runtime":"containerd"}\n'
    );

    expect(detectContext()).toBeNull();
  });

  it("returns null when the running Docker profile has no name", () => {
    vi.mocked(execSync).mockReturnValue(
      '{"status":"Running","runtime":"docker"}\n'
    );

    expect(detectContext()).toBeNull();
  });
});

describe("buildContextArgs", () => {
  it("returns docker context args when context is provided", () => {
    expect(buildContextArgs("docker", "colima")).toEqual(["--context", "colima"]);
  });

  it("returns an empty array for podman", () => {
    expect(buildContextArgs("podman", "colima")).toEqual([]);
  });

  it("returns an empty array when context is null", () => {
    expect(buildContextArgs("docker", null)).toEqual([]);
  });

  it("returns an empty array when context is empty", () => {
    expect(buildContextArgs("docker", "")).toEqual([]);
  });
});
