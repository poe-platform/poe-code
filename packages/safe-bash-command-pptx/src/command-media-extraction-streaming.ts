import {
  RetainedMediaSelectionError,
  stageRetainedMediaSelectionError
} from "safe-bash-presentation-engine/media";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  openRetainedMediaExtraction,
  stageRetainedExtractionOutput
} from "safe-bash-presentation-engine/media-extraction";
import { openPackageArchive } from "safe-bash-presentation-engine/retained-package";
import type { ReadMediaOptions } from "safe-bash-presentation-engine/media";
import type {
  AdmittedCommandEngineOptions,
  PptxCommandRequest,
  PptxStreamPublicationRequest
} from "./command-engine.js";
export async function prepareRetainedMediaExtraction(
  args: {
    readonly input?: string;
    readonly outputDir?: string;
    readonly json: boolean;
    readonly scope?: ReadMediaOptions["scope"];
    readonly slide?: number;
    readonly shape?: string;
    readonly token?: string;
    readonly deduplicate?: boolean;
    readonly force?: boolean;
    readonly allowPartialOutput?: boolean;
    readonly limits?: Readonly<Record<string, number>>;
  },
  request: PptxCommandRequest & {
    readonly streaming: NonNullable<PptxCommandRequest["streaming"]>;
  },
  options: AdmittedCommandEngineOptions
) {
  const { streaming, signal } = request,
    context = { ...options.context, signal, workingStorage: streaming.workingStorage };
  const input = await streaming.openInput(
      args.input!,
      Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
    ),
    hash = sha256.create();
  for await (const bytes of input.stream()) {
    signal.throwIfAborted();
    hash.update(bytes);
  }
  const fingerprint = Array.from(hash.digest(), (b) => b.toString(16).padStart(2, "0")).join(""),
    archive = await openPackageArchive(input, context);
  let diagnostic: Awaited<ReturnType<typeof stageRetainedMediaSelectionError>> | undefined;
  let extraction: Awaited<ReturnType<typeof openRetainedMediaExtraction>> | undefined,
    response: Awaited<ReturnType<typeof stageRetainedExtractionOutput>> | undefined,
    closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      const results = await Promise.allSettled([
        diagnostic?.close(),
        response?.close(),
        extraction?.close(),
        archive.close()
      ]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })());
  try {
    extraction = await openRetainedMediaExtraction(
      archive,
      fingerprint,
      {
        ...(args.scope === undefined ? {} : { scope: args.scope }),
        ...(args.slide === undefined ? {} : { slide: args.slide }),
        ...(args.shape === undefined ? {} : { shape: args.shape }),
        ...(args.token === undefined ? {} : { select: args.token }),
        ...(args.deduplicate === undefined ? {} : { deduplicate: args.deduplicate }),
        maxOutputBytes: options.maxOutputBytes,
        maxOutputs: args.limits?.maxOutputs ?? context.archiveLimits.maxMembers
      },
      context
    );
    if (!request.publishOutputStreams && (!args.allowPartialOutput || !request.publishOutput))
      throw Object.assign(
        new Error("Media extraction requires atomic publication or explicit partial output."),
        { code: "publication-unsupported" }
      );
    response = await stageRetainedExtractionOutput(extraction, context, {
      directory: args.outputDir!,
      json: args.json,
      maxOutputBytes: options.maxOutputBytes,
      allowPartialOutput: args.allowPartialOutput ?? false,
      operation: "media.extract"
    });
    async function* publications(dryRun: boolean): AsyncGenerator<PptxStreamPublicationRequest> {
      for await (const member of extraction!.members()) {
        signal.throwIfAborted();
        yield {
          inputPath: args.input!,
          outputPath: response!.path(member.name),
          bytes: member.bytes(),
          originalBytes: input,
          inPlace: false,
          force: args.force ?? false,
          dryRun
        };
      }
    }
    return {
      close,
      async publish() {
        let published = 0,
          code: string | undefined;
        try {
          for await (const item of publications(true)) {
            if (request.preflightOutputStream) await request.preflightOutputStream(item);
            else if (request.publishOutput) await request.publishOutput(item);
          }
          if (request.publishOutputStreams) await request.publishOutputStreams(publications(false));
          else
            for await (const item of publications(false)) {
              await request.publishOutput!(item);
              published++;
            }
        } catch (error) {
          const raw =
            error && typeof error === "object" && "code" in error ? error.code : undefined;
          code = signal.aborted
            ? "cancelled"
            : typeof raw === "string" &&
                ["resource-limit", "stale-input", "publication-unsupported"].includes(raw)
              ? raw
              : "io-failure";
        }
        await response!.write(
          !code || args.json ? streaming.stdout : streaming.stderr,
          code ? { code, published } : undefined
        );
        return {
          exitCode: !code
            ? 0
            : code === "cancelled"
              ? 130
              : code === "resource-limit"
                ? 4
                : code === "stale-input"
                  ? 1
                  : 3,
          stdout: new Uint8Array(),
          stderr: new Uint8Array()
        };
      }
    };
  } catch (error) {
    if (error instanceof RetainedMediaSelectionError) {
      try {
        diagnostic = await stageRetainedMediaSelectionError(error, context, {
          operation: "media.extract",
          json: args.json,
          maxOutputBytes: options.maxOutputBytes
        });
        await archive.close();
        return {
          close,
          async publish() {
            await diagnostic!.write(args.json ? streaming.stdout : streaming.stderr);
            return { exitCode: 1, stdout: new Uint8Array(), stderr: new Uint8Array() };
          }
        };
      } catch (failure) {
        await close().catch(() => {});
        throw failure;
      }
    }
    await close().catch(() => {});
    throw error;
  }
}
