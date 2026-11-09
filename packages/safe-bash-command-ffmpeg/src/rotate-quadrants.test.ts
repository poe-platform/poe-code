import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// RGBA 9x5 grid with nonuniform colors and alpha, including its boundary pixels.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAFCAYAAACXU8ZrAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6Mzg6NDgrMDA6MDDt793cAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjM4OjQ4KzAwOjAwnLJlYAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDozODo0OCswMDowMMunRL8AAADESURBVAjXAbkARv8ACwXxN1JidFSZv/dx4Bx6jid5/atu1oDItTMD5fyQhgJD7QkfBH9FmwVHRZsFR0UeBcZdmwV/RR4FR0WbBUddmwXGRYMFf0WbBQAJjydBUOyqXpdJLXveprCYJQMztWxgttKzvTnv+hq8DEF3PykAiNTCRs8xRWMWjsiAXetLnaRIzrrrpVHXMgLU9HlfVxHAvNouAAcZXUtOduBoldNjhdww5qIjjWm/aurs3LFHb/n4pPIWPwF1M4URUxl8/AvFAAAAAElFTkSuQmCC", "base64");

// Full RGBA frames from FFmpeg 7.0.2: -i grid9x5.png -vf rotate=ANGLE
// -frames:v 1 -f rawvideo -pix_fmt rgba pipe:1 (default canvas, fill and interpolation).
for (const [angle, expected] of [
  [
    "0",
    "CwXxN1JidFSZv/dx4Bx6jid5/atu1oDItTMD5fyQhgJD7QkfikqMPNGnD1kYBJJ2X2EVk6a+mLDtGxvNNHie6nvVIQfCMqQkCY8nQVDsql6XSS173qawmCUDM7VsYLbSs7057/oavAxBdz8piNTCRs8xRWMWjsiAXetLnaRIzrrrpVHXMgLU9HlfVxHAvNouBxldS0524GiV02OF3DDmoiONab9q6uzcsUdv+fik8hY/AXUz"
  ],
  [
    "2*PI",
    "CwXxN1JidFSZv/dx4Bx6jid5/atu1oDItTMD5fyQhgJD7QkfikqMPNGnD1kYBJJ2X2EVk6a+mLDtGxvNNHie6nvVIQfCMqQkCY8nQVDsql6XSS173qawmCUDM7VsYLbSs7057/oavAxBdz8piNTCRs8xRWMWjsiAXetLnaRIzrrrpVHXMgLU9HlfVxHAvNouBxldS0524GiV02OF3DDmoiONab9q6uzcsUdv+fik8hY/AXUz"
  ],
  [
    "PI",
    "PwF1M/ik8haxR2/5aurs3CONab/cMOaildNjhU524GgHGV1LwLzaLnlfVxEyAtT066VR16RIzrpd60udFo7IgM8xRWOI1MJGQXc/KfoavAyzvTnvbGC20iUDM7XeprCYl0kte1Dsql4JjydBwjKkJHvVIQc0eJ7q7Rsbzaa+mLBfYRWTGASSdtGnD1mKSow8Q+0JH/yQhgK1MwPlbtaAyCd5/avgHHqOmb/3cVJidFQLBfE3"
  ],
  [
    "PI/2",
    "AAAA/5XTY4WV02OFFo7IgJdJLXsYBJJ2mb/3cZm/93EAAAD/AAAA/9ww5qLcMOaiXetLnd6msJhfYRWT4Bx6juAceo4AAAD/AAAA/yONab8jjWm/pEjOuiUDM7WmvpiwJ3n9qyd5/asAAAD/AAAA/2rq7Nxq6uzc66VR12xgttLtGxvNbtaAyG7WgMgAAAD/AAAA/7FHb/mxR2/5MgLU9LO9Oe80eJ7qtTMD5bUzA+UAAAD/"
  ],
  [
    "PI/2-0.0000001",
    "AAAA/5XTY4WV02OFFo7IgJdJLXsYBJJ2mb/3cZm/93EAAAD/AAAA/9ww5qLcMOaiXetLnd6msJhfYRWT4Bx6juAceo4AAAD/AAAA/yONab8jjWm/pEjOuiUDM7WmvpiwJ3n9qyd5/asAAAD/AAAA/2rq7Nxq6uzc66VR12xgttLtGxvNbtaAyG7WgMgAAAD/AAAA/7FHb/mxR2/5MgLU9LO9Oe80eJ7qtTMD5bUzA+UAAAD/"
  ],
  [
    "PI/2+0.0000001",
    "AAAA/5XTY4WV02OFFo7IgJdJLXsYBJJ2mb/3cZm/93EAAAD/AAAA/9ww5qLcMOaiXetLnd6msJhfYRWT4Bx6juAceo4AAAD/AAAA/yONab8jjWm/pEjOuiUDM7WmvpiwJ3n9qyd5/asAAAD/AAAA/2rq7Nxq6uzc66VR12xgttLtGxvNbtaAyG7WgMgAAAD/AAAA/7FHb/mxR2/5MgLU9LO9Oe80eJ7qtTMD5bUzA+UAAAD/"
  ],
  [
    "-PI/2",
    "AAAA/7UzA+W1MwPlNHie6rO9Oe8yAtT0sUdv+bFHb/kAAAD/AAAA/27WgMhu1oDI7RsbzWxgttLrpVHXaurs3Grq7NwAAAD/AAAA/yd5/asnef2rpr6YsCUDM7WkSM66I41pvyONab8AAAD/AAAA/+Aceo7gHHqOX2EVk96msJhd60ud3DDmotww5qIAAAD/AAAA/5m/93GZv/dxGASSdpdJLXsWjsiAldNjhZXTY4UAAAD/"
  ],
  [
    "0.3",
    "kJNPTq16Skt0aHBlh1mXgJJIppqlh3+5m21O065aOKcAAAD/ZL2KW03YjVhtUVhzeGFTjY6dcKe0a17Bi2RM3MlyT2SfiGEVfZ2hTKtOXmZReoaAsrOPmiUDM7WOSoXPb4ty6X+3PyWmaHgdKEWbWG+To3N2oZaNf5qIqLNgpcKnen7ckmp5wtYtoxFeZ1UnPWDBYYG5hX3FZLyYZmuWtFi9sc+MdqHpfkaeg5mIkx6dqa8s"
  ]
] as const) {
  it(`matches every native RGBA byte for rotate=${angle}`, async () => {
    const volume = Volume.fromJSON({ "/in.png": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.png", "-vf", `rotate=${angle}`, "-frames:v", "1", "/out.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.deepEqual([output.width, output.height, output.channels], [9, 5, 4]);
    assert.deepEqual(Buffer.from(output.data), Buffer.from(expected, "base64"));
    assert.deepEqual(volume.readFileSync("/in.png"), input);
  });
}
