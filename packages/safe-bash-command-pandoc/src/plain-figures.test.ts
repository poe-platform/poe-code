import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";

it.each([
  ['<figure><figcaption>Caption</figcaption><p>Body</p></figure>', "Body\n"],
  ['<figure><img src="photo.png" alt="Photo"><figcaption>Caption</figcaption></figure>', "[Caption]\n"],
  ['<figure><img src="photo.png" alt="Photo" title="Title"><figcaption>A <em>rich</em> caption</figcaption></figure>', "[A rich caption]\n"],
  ['<figure><img src="photo.png" alt="Photo"></figure>', "[]\n"],
  ['<figure><figcaption>Caption</figcaption></figure>', "\n"],
  ['<p>Body</p><p>Caption</p>', "Body\n\nCaption\n"],
])("matches native figure projection for %s", async (html, expected) => {
  const input = {bytes: new TextEncoder().encode(html)};
  const options = {from: "html", to: "plain"};
  expect(await convert([input], options, {})).toMatchObject({text: expected, diagnostics: []});
  const fs = new MemoryFileSystem();
  let text = "";
  const result = await convertToOutput([input], options, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(text).toBe(expected);
  expect(result.diagnostics).toEqual([]);
  expect(await fs.readdir("/")).toEqual([]);
});
