import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createFFmpegShims, grammarRevision, nativeReference } from "./index.js";
const b = (s: string) => new TextEncoder().encode(s);
const binding = { grammarRevision, build: nativeReference.id, lateAccess: "complete" as const, argv: "bytes" as const, effects: "live" as const };
it.each(['ffmpeg', 'ffprobe'] as const)('rejects a changing %s argv instead of silently dropping arguments', async tool => {
  const argv = [b('-i'), b('source.wav')];
  Object.defineProperty(argv, 1, { get() {
    argv.push(b('out.wav'));
    return b('source.wav');
  } });
  const run = vi.fn(async () => ({ exitCode: 0 }));
  await expect(createFFmpegShims({ ...binding, run })[tool](argv, {})).rejects.toThrow('Native argv');
  expect(run).not.toHaveBeenCalled();
});
it('rejects malformed or absent argv slots instead of coercing them into native arguments', async () => {
  const run = vi.fn(async () => ({ exitCode: 0 }));
  const shim = createFFmpegShims({ ...binding, run }).ffmpeg;
  for (const argv of [[3], ['input.wav'], [undefined], [new Uint16Array([255])], new Array(1), { length: 0 }]) {
    await expect(shim(argv as unknown as Uint8Array[], {})).rejects.toThrow('Native argv');
  }
  expect(run).not.toHaveBeenCalled();
});
it('copies original argv slots without calling a caller-supplied map implementation', async () => {
  const argv = [b('-i'), new Uint8Array([255]), b('')];
  const map = vi.fn(() => [b('different.wav')]);
  argv.map = map as typeof argv.map;
  const run = vi.fn(async request => {
    expect(request.argv).toEqual([b('-i'), new Uint8Array([255]), b('')]);
    return { exitCode: 0 };
  });
  await createFFmpegShims({ ...binding, run }).ffmpeg(argv, {});
  expect(map).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(1);
});
it('retains the admitted native binding when the caller changes its configuration', async () => {
  const run = vi.fn(async () => ({ exitCode: 17 }));
  const replacement = vi.fn(async () => ({ exitCode: 0 }));
  const configuration = { ...binding, run };
  const shims = createFFmpegShims(configuration);
  configuration.build = 'unqualified-build';
  configuration.run = replacement;
  expect(await shims.ffmpeg(['-i', 'source.wav', 'out.wav'].map(b), {})).toEqual({ exitCode: 17 });
  expect(run).toHaveBeenCalledTimes(1);
  expect(replacement).not.toHaveBeenCalled();
});
it('leaves unknown filter names resembling object properties to native validation', async () => {
  const run = vi.fn(async () => ({ exitCode: 234 }));
  const shims = createFFmpegShims({ ...binding, run });
  for (const name of ['constructor', 'toString', '__proto__']) {
    const argv = ['-vf', `${name}=file=missing.cube`, 'out'].map(b);
    expect(await shims.ffmpeg(argv, {})).toEqual({ exitCode: 234 });
  }
  expect(run).toHaveBeenCalledTimes(3);
});
it("runs once, preserves bytes and streams, and passes native status through", async () => {
  const context = { stdin: {}, stdout: {}, stderr: {}, env: { EMPTY: "" }, cwd: "/" };
  const run = vi.fn(async request => {
    expect(request.context).toBe(context);
    expect(request.argv).toEqual([b("-y"), b("-n"), b("-i"), new Uint8Array([255]), b("")]);
    request.discovery.argv[0][0] = 0;
    expect(request.argv[0]).toEqual(b("-y"));
    return { exitCode: 17 };
  });
  const shims = createFFmpegShims({ ...binding, run });
  expect(await shims.ffmpeg([b("-y"), b("-n"), b("-i"), new Uint8Array([255]), b("")], context)).toEqual({ exitCode: 17 });
  expect(run).toHaveBeenCalledTimes(1);
});
it("does not pre-read missing predictions, whitelist late resources, or roll back partial effects", async () => {
  const fs = Volume.fromJSON({ "/late": "dynamic content" });
  const run = vi.fn(async request => {
    expect(request.discovery.dependencies).toEqual([]);
    expect(fs.readFileSync("/late", "utf8")).toBe("dynamic content");
    fs.writeFileSync("/partial", "native wrote this before error");
    expect(() => fs.readFileSync("/missing-late")).toThrow();
    return { exitCode: 1 };
  });
  const shims = createFFmpegShims({ ...binding, run });
  expect(await shims.ffmpeg([b("-unknown")], { fs })).toEqual({ exitCode: 1 });
  expect(fs.readFileSync("/partial", "utf8")).toBe("native wrote this before error");
  expect(run).toHaveBeenCalledTimes(1);
});
it("keeps transport/auth failures as errors without retry or invented native diagnostics", async () => {
  const error = new Error("remote authentication failed");
  const run = vi.fn(async () => { throw error; });
  await expect(createFFmpegShims({ ...binding, run }).ffprobe([b("missing")], {})).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);
});
it.each(['ffmpeg', 'ffprobe'] as const)('reports malformed %s binding results as remote errors after the single execution', async tool => {
  const fs = Volume.fromJSON({});
  for (const result of [undefined, null, {}, { exitCode: -1 }, { exitCode: 256 }, { exitCode: 1.5 }, { exitCode: '1' }]) {
    const run = vi.fn(async () => {
      fs.writeFileSync('/partial', 'native effect');
      return result;
    });
    const shim = createFFmpegShims({ ...binding, run: run as never })[tool];
    await expect(shim([b('-i'), b('source.wav'), b('out.wav')], { fs })).rejects.toThrow('Invalid native exit status');
    expect(run).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync('/partial', 'utf8')).toBe('native effect');
  }
});
it.each([0, 1, 17, 255])('preserves native exit status %i for both tools', async exitCode => {
  const run = vi.fn(async () => ({ exitCode }));
  const shims = createFFmpegShims({ ...binding, run });
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    expect(await shims[tool]([b('-native-owned-syntax')], {})).toEqual({ exitCode });
  }
  expect(run).toHaveBeenCalledTimes(2);
});
it("refuses an incompatible binding before effects and rejects only non-native NUL argv", async () => {
  const run = vi.fn();
  expect(() => createFFmpegShims({ ...binding, build: "drift", run })).toThrow("build");
  expect(() => createFFmpegShims({ ...binding, lateAccess: "snapshot" as "complete", run })).toThrow("late access");
  await expect(createFFmpegShims({ ...binding, run }).ffmpeg([new Uint8Array([0])], {})).rejects.toThrow("NUL");
  expect(run).not.toHaveBeenCalled();
});
