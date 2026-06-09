import nodeFs from "node:fs/promises";
import { basename as pathBasename, dirname, extname, join } from "node:path";

import { hasOwnErrorCode } from "../error-codes.js";

export type HarnessPair = {
  ajsPath: string;
  mdPath: string;
  basename: string;
};

export type HarnessFs = {
  readdir?(
    path: string,
    options?: { withFileTypes?: boolean }
  ): Promise<Array<string | { name: string; isDirectory(): boolean }>>;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory?(): boolean }>;
};

type HarnessPairSide = "ajs" | "md";

export class MissingPairError extends Error {
  readonly side: HarnessPairSide;
  readonly path: string;

  constructor(side: HarnessPairSide, path: string) {
    super(`Missing harness ${side} file: ${path}`);
    this.name = "MissingPairError";
    this.side = side;
    this.path = path;
  }
}

export class InvalidPairExtensionError extends Error {
  readonly extension: string;
  readonly path: string;

  constructor(path: string, extension: string) {
    super(`Harness pair input must be a .md or .ajs file: ${path}`);
    this.name = "InvalidPairExtensionError";
    this.extension = extension;
    this.path = path;
  }
}

export async function resolvePair(inputPath: string, fs: HarnessFs = nodeFs): Promise<HarnessPair> {
  const extension = extname(inputPath);

  if (extension !== ".md" && extension !== ".ajs") {
    throw new InvalidPairExtensionError(inputPath, extension);
  }

  const pairBasename = pathBasename(inputPath, extension);
  const pairDir = dirname(inputPath);
  const pair: HarnessPair = {
    ajsPath: join(pairDir, `${pairBasename}.ajs`),
    mdPath: join(pairDir, `${pairBasename}.md`),
    basename: pairBasename
  };

  const checks: Array<{ side: HarnessPairSide; path: string }> =
    extension === ".md"
      ? [
          { side: "md", path: pair.mdPath },
          { side: "ajs", path: pair.ajsPath }
        ]
      : [
          { side: "ajs", path: pair.ajsPath },
          { side: "md", path: pair.mdPath }
        ];

  for (const check of checks) {
    let stat: { isFile(): boolean };
    try {
      stat = await fs.stat(check.path);
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) {
        throw new MissingPairError(check.side, check.path);
      }

      throw error;
    }

    if (!stat.isFile()) {
      throw new MissingPairError(check.side, check.path);
    }
  }

  return pair;
}
