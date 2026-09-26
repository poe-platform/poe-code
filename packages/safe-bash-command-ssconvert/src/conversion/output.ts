import { SsconvertError, type ConversionRequest, type Destination } from "../contracts.js";
import type { ServiceDescriptor } from "../codecs.js";
import { resourceUri } from "../resource-uri.js";
import { imageFormats } from "../rendering/images/formats.js";

/** GFile command-line local URI identity, before extension inference. Remote URIs stay opaque. */
export function conversionUri(filename: string, cwd: string): string {
  const uri = resourceUri(filename, cwd);
  const colon = uri.indexOf(":");
  if (uri.slice(0, colon).toLowerCase() !== "file") return uri;
  let location = uri.slice(colon + 1);
  if (location.startsWith("//")) {
    const slash = location.indexOf("/", 2);
    if (slash < 0) return uri;
    location = location.slice(slash);
  }
  if (!location.startsWith("/")) return uri;
  const path = location.split("?")[0]!.split("#")[0]!;
  const parts: string[] = [];
  try {
    for (const encoded of path.split("/")) {
      const part = decodeURIComponent(encoded);
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    return `file:///${parts.map((part) => Array.from(part, (character) =>
      "!$&'()*+,=:@".includes(character) ? character : encodeURIComponent(character)).join("")).join("/")}`;
  } catch { return uri; }
}

/** The source replaces the extension pointer in the URI, without inserting a dot. */
export function resolveOutput(request: ConversionRequest, services: readonly ServiceDescriptor[], cwd: string): Destination {
  if (request.destination) return request.destination;
  if (request.exportType !== undefined && !request.graphs && request.clipboard === undefined) {
    const exporter = services.find((service) => service.id === request.exportType);
    if (!exporter) throw new SsconvertError("invalid-request", `Unknown exporter '${request.exportType}'.\nTry --list-exporters to see a list of possibilities.`);
    const extension = exporter.extensions[0];
    const filename = request.input.kind === "resource" ? request.input.uri : request.input.filename;
    if (!request.perSheet && extension !== undefined && filename !== undefined) {
      const uri = conversionUri(filename, cwd);
      const dot = uri.lastIndexOf(".");
      const pointer = dot > uri.lastIndexOf("/") ? dot + 1 : uri.length;
      return { kind: "resource", uri: uri.slice(0, pointer) + extension };
    }
  }
  throw new SsconvertError("invalid-request", "An output file name or an explicit export type is required.\nTry --list-exporters to see a list of possibilities.");
}

export function imageFormat(destination: Destination, type: string | undefined, cwd: string): string {
  if (type !== undefined && type !== "auto") return type;
  const uri = destination.kind === "resource" ? conversionUri(destination.uri, cwd) : "";
  const dot = uri.lastIndexOf(".");
  const extension = dot > uri.lastIndexOf("/") ? uri.slice(dot + 1).toLowerCase() : "";
  return imageFormats.find(format => format.extension === extension)?.id ?? "svg";
}
