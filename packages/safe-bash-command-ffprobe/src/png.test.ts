import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// Complete 12x3 PNGs with zero-valued samples, generated using Python zlib.
// Cover every legal IHDR color type / sample depth combination.
it.each([
  { colorType: 0, depth: 1, pixFmt: "monob", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADAQAAAACPWNOfAAAAC0lEQVR4nGNggAIAAAkAAftSuKkAAAAASUVORK5CYII=" },
  { colorType: 0, depth: 2, pixFmt: "gray", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADAgAAAADI+KlPAAAAC0lEQVR4nGNgQAAAAAwAAXxMRMIAAAAASUVORK5CYII=" },
  { colorType: 0, depth: 4, pixFmt: "gray", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADBAAAAABHuFzvAAAAC0lEQVR4nGNgwAIAABUAAapll8QAAAAASUVORK5CYII=" },
  { colorType: 0, depth: 8, pixFmt: "gray", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADCAAAAACCSLHuAAAADElEQVR4nGNgIAoAAAAnAAHKRxGqAAAAAElFTkSuQmCC" },
  { colorType: 0, depth: 16, pixFmt: "gray16be", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADEAAAAADS2G2tAAAADElEQVR4nGNgoBoAAABLAAG/bzr6AAAAAElFTkSuQmCC" },
  { colorType: 2, depth: 8, pixFmt: "rgb24", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADCAIAAAAoQXllAAAADElEQVR4nGNgoCsAAABvAAGOP3ogAAAAAElFTkSuQmCC" },
  { colorType: 2, depth: 16, pixFmt: "rgb48be", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADEAIAAAB40aUmAAAADElEQVR4nGNgGLYAAADbAAHHZPYCAAAAAElFTkSuQmCC" },
  { colorType: 3, depth: 1, pixFmt: "pal8", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADAQMAAACd7XxxAAAABlBMVEUAAAD///+l2Z/dAAAAC0lEQVR4nGNggAIAAAkAAftSuKkAAAAASUVORK5CYII=" },
  { colorType: 3, depth: 2, pixFmt: "pal8", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADAgMAAADaTQahAAAABlBMVEUAAAD///+l2Z/dAAAAC0lEQVR4nGNgQAAAAAwAAXxMRMIAAAAASUVORK5CYII=" },
  { colorType: 3, depth: 4, pixFmt: "pal8", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADBAMAAABVDfMBAAAABlBMVEUAAAD///+l2Z/dAAAAC0lEQVR4nGNgwAIAABUAAapll8QAAAAASUVORK5CYII=" },
  { colorType: 3, depth: 8, pixFmt: "pal8", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADCAMAAACQ/R4AAAAABlBMVEUAAAD///+l2Z/dAAAADElEQVR4nGNgIAoAAAAnAAHKRxGqAAAAAElFTkSuQmCC" },
  { colorType: 4, depth: 8, pixFmt: "ya8", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADCAQAAAANKia5AAAADElEQVR4nGNgoBoAAABLAAG/bzr6AAAAAElFTkSuQmCC" },
  { colorType: 4, depth: 16, pixFmt: "ya16be", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADEAQAAABduvr6AAAADElEQVR4nGNgGHQAAACTAAHib6TYAAAAAElFTkSuQmCC" },
  { colorType: 6, depth: 8, pixFmt: "rgba", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADCAYAAACnI+4yAAAADElEQVR4nGNgGHQAAACTAAHib6TYAAAAAElFTkSuQmCC" },
  { colorType: 6, depth: 16, pixFmt: "rgba64be", png: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAADEAYAAAD3szJxAAAADUlEQVR4nGNgGAUEAAABIwABjQO/kwAAAABJRU5ErkJggg==" }
])("reports PNG color type $colorType at depth $depth as $pixFmt", async ({ png, pixFmt }) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.bin", Buffer.from(png, "base64"));
  let output = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe",
    ...createCommandArguments(["-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt", "-of", "json", "/input.bin"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output)).toMatchObject({
    streams: [{ codec_name: "png", width: 12, height: 3, pix_fmt: pixFmt }]
  });
});
