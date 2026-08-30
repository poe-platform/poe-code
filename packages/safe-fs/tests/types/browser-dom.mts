import { WebDavFileSystem, type WebDavFetch } from "poe-code/safe-fs";

type Assert<Condition extends true> = Condition;
export type RequestInitRemainsUnmodified = Assert<
  "duplex" extends keyof RequestInit ? false : true
>;

const transport: WebDavFetch = globalThis.fetch;
const filesystem = new WebDavFileSystem({
  baseUrl: "https://example.invalid/dav/",
  fetch: transport
});
const upload: (path: string, source: AsyncIterable<Uint8Array>) => Promise<void> =
  filesystem.writeStream.bind(filesystem);
void upload;
