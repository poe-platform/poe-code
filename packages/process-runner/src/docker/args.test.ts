import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DockerRunArgs } from "../types.js";
import { buildDockerRunArgs } from "./args.js";

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
      "FOO=bar",
      "-e",
      "HELLO=world",
      "node:22",
      "node"
    ]);
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
      "FOO=bar",
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
