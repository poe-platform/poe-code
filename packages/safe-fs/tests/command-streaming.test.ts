import { expect, it } from "vitest";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { csvcut } from "../../safe-bash-command-csvcut/src/command.js";
import { csvgrep } from "../../safe-bash-command-csvgrep/src/command.js";
import { fold } from "../../safe-bash-command-fold/src/command.js";
import { fmt } from "../../safe-bash-command-fmt/src/command.js";
import { input } from "../../safe-bash-io-engine/src/internal.js";

// The filesystem generates payloads in one reusable window. No payload file,
// output collection, RAM spool or host filesystem participates in this fixture.
for (const size of [4096, 16384, 65536]) {
  for (const command of ["csvcut", "csvgrep", "fold", "fmt", "generic"]) {
    it(`${command} consumes ${size} generated range bytes with bounded outstanding output`, async () => {
      const pattern = new TextEncoder().encode("x,y\n");
      const buffer = new Uint8Array(65536);
      let read = 0, closed = 0, output = 0, pending = false, maxRead = 0;
      const cleanups: Array<() => Promise<void>> = [];
      const carrier = createCommandArguments([]);
      const context = {
        command, args: carrier.args, argumentValues: carrier, cwd: "/", env: {},
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        registerCleanup(cleanup: () => Promise<void>) { cleanups.push(cleanup); },
        fs: {
          capabilities: { read: false, retainedRead: true, streamingRead: false },
          readFile() { throw new Error("whole-payload read"); },
          writeFile() { throw new Error("RAM spool"); },
          appendFile() { throw new Error("RAM spool"); },
          async openReadFile() { return {
            async read(position: number, maximum: number) {
              expect(pending).toBe(false);
              expect(position).toBe(read);
              expect(maximum).toBeLessThanOrEqual(buffer.length);
              maxRead = Math.max(maxRead, maximum);
              const length = Math.min(maximum, size - position);
              for (let i = 0; i < length; i++) buffer[i] = pattern[(position + i) % pattern.length]!;
              read += length;
              return buffer.subarray(0, length);
            },
            async close() { closed++; buffer.fill(0); },
          }; },
        },
        stdout: { async write(bytes: Uint8Array) {
          expect(pending).toBe(false); pending = true;
          await Promise.resolve(); // Source acquisition cannot outrun the sink.
          if (command !== "fmt") {
            const expected = command === "csvcut" ? [120, 10] : pattern;
            let valid = true;
            for (const byte of bytes) if (byte !== expected[output++ % expected.length]) valid = false;
            expect(valid).toBe(true);
          } else output += bytes.length;
          pending = false;
        } },
        stderr: { async write(bytes: Uint8Array) { throw new Error(new TextDecoder().decode(bytes)); } },
      } as unknown as CommandContext;
      if (command === "generic") {
        for await (const bytes of input(context, "/input")) await context.stdout.write(bytes);
      } else {
        const result = command === "csvcut" ? await csvcut(context, { filePath: "/input", include: "1" })
          : command === "csvgrep" ? await csvgrep(context, { filePath: "/input", columns: "1", match: "x" })
          : command === "fold" ? await fold(context, { files: ["/input"], width: 80 })
          : await fmt(context, { files: ["/input"], width: 80 });
        expect(result.exitCode).toBe(0);
      }
      await Promise.all(cleanups.map(cleanup => cleanup()));
      expect(read).toBe(size);
      expect(closed).toBe(1);
      expect(maxRead).toBeLessThanOrEqual(65536);
      expect(output).toBe(command === "csvcut" ? size / 2 : size);
    });
  }
}
