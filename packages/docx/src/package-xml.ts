import { SaxesParser, type SaxesTagNS } from "saxes";

export class InvalidPackageError extends Error {
  readonly code = "invalid-package";
}
export class InvalidXmlError extends Error {
  readonly code = "invalid-xml";
}

export class UnsupportedProfileError extends Error {
  readonly code = "unsupported-profile";
}

// Parse bounded admitted bytes without retaining a document tree or resolving entities.
export function xml(
  bytes: Uint8Array,
  visit: (tag: SaxesTagNS, depth: number) => void,
  elementOnly = false
): void {
  try {
    let encoding = "utf-8";
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
    const decoder = new TextDecoder(encoding, { fatal: true });
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0;
    const rejectXml = () => {
      throw new InvalidXmlError("Malformed or prohibited document XML.");
    };
    parser.on("error", rejectXml);
    parser.on("doctype", rejectXml);
    if (elementOnly) {
      const text = (value: string) => {
        if ([...value].some((char) => !" \t\r\n".includes(char)))
          throw new InvalidPackageError("Unexpected package metadata text.");
      };
      parser.on("text", text);
      parser.on("cdata", text);
    }
    parser.on("opentag", (tag) => visit(tag, ++depth));
    parser.on("closetag", () => {
      depth--;
    });
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      parser.write(decoder.decode(bytes.subarray(offset, offset + 4096), { stream: true }));
    }
    parser.write(decoder.decode()).close();
  } catch (error) {
    if (
      error instanceof UnsupportedProfileError ||
      error instanceof InvalidPackageError ||
      error instanceof InvalidXmlError
    )
      throw error;
    throw new InvalidXmlError("Malformed or prohibited document XML.");
  }
}
