import type { CommandDefinition } from "../../contracts/command.js";
import { commandRuntimeIdentity, getCommandArguments } from "../../contracts/command.js";
import { shellValueByteLength } from "../../contracts/value.js";
import { assertCountedFileOutput, writeFileOutputCounted } from "../../contracts/filesystem-output.js";
import type { VirtualShellPlugin } from "../../contracts/plugin.js";
import { FsError } from "poe-code/safe-fs";
import { writeBytes } from "../../contracts/io.js";
import { createOutputOperation } from "../../contracts/output.js";
import { yieldTurn } from "../../contracts/yield.js";
import { DdConverter } from "./conversions.js";
import { errorMessage, openDdFile, writeDdOutput, type DdFileHandle, type DdFileOpener, type DdFileRequest } from "./io.js";
import { DdError, parseDd, quote, type DdPlan } from "./options.js";
import { DdReporter } from "./report.js";

export { openDdFile } from "./io.js";
export type { DdFileHandle, DdFileOpener, DdFileRequest } from "./io.js";

export interface DdCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly maxBlockBytes?: number | undefined;
  readonly maxBufferBytes?: number | undefined;
  readonly maxTransferBytes?: number | undefined;
  readonly maxReadOperations?: number | undefined;
  readonly maxArgumentBytes?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly openFile?: DdFileOpener | undefined;
}

const help = `Usage: dd [OPERAND]...
  or:  dd OPTION
Copy a file, converting and formatting according to the operands.

  bs=BYTES        read and write up to BYTES bytes at a time (default: 512);
                  overrides ibs and obs
  cbs=BYTES       convert BYTES bytes at a time
  conv=CONVS      convert the file as per the comma separated symbol list
  count=N         copy only N input blocks
  ibs=BYTES       read up to BYTES bytes at a time (default: 512)
  if=FILE         read from FILE instead of stdin
  iflag=FLAGS     read as per the comma separated symbol list
  obs=BYTES       write BYTES bytes at a time (default: 512)
  of=FILE         write to FILE instead of stdout
  oflag=FLAGS     write as per the comma separated symbol list
  seek=N          (or oseek=N) skip N obs-sized output blocks
  skip=N          (or iseek=N) skip N ibs-sized input blocks
  status=LEVEL    The LEVEL of information to print to stderr;
                  'none' suppresses everything but error messages,
                  'noxfer' suppresses the final transfer statistics,
                  'progress' shows periodic transfer statistics

N and BYTES may be followed by the following multiplicative suffixes:
c=1, w=2, b=512, kB=1000, K=1024, MB=1000*1000, M=1024*1024, xM=M,
GB=1000*1000*1000, G=1024*1024*1024, and so on for T, P, E, Z, Y, R, Q.
Binary prefixes can be used, too: KiB=K, MiB=M, and so on.
If N ends in 'B', it counts bytes not blocks.

Each CONV symbol may be:

  ascii     from EBCDIC to ASCII
  ebcdic    from ASCII to EBCDIC
  ibm       from ASCII to alternate EBCDIC
  block     pad newline-terminated records with spaces to cbs-size
  unblock   replace trailing spaces in cbs-size records with newline
  lcase     change upper case to lower case
  ucase     change lower case to upper case
  sparse    try to seek rather than write all-NUL output blocks
  swab      swap every pair of input bytes
  sync      pad every input block with NULs to ibs-size; when used
            with block or unblock, pad with spaces rather than NULs
  excl      fail if the output file already exists
  nocreat   do not create the output file
  notrunc   do not truncate the output file
  noerror   continue after read errors
  fdatasync  physically write output file data before finishing
  fsync     likewise, but also write metadata

Each FLAG symbol may be:

  append    append mode (makes sense only for output; conv=notrunc suggested)
  directory  fail unless a directory
  dsync     use synchronized I/O for data
  sync      likewise, but also for metadata
  fullblock  accumulate full blocks of input (iflag only)
  nonblock  use non-blocking I/O
  noctty    do not assign controlling terminal from file
  nofollow  do not follow symlinks

Sending a INFO signal to a running 'dd' process makes it
print I/O statistics to standard error and then resume copying.

Options are:

      --help        display this help and exit
      --version     output version information and exit

GNU coreutils online help: <https://www.gnu.org/software/coreutils/>
Report any translation bugs to <https://translationproject.org/team/>
Full documentation <https://www.gnu.org/software/coreutils/dd>
or available locally via: info '(coreutils) dd invocation'
`;

export function createDdCommand(options: DdCommandsOptions = {}): CommandDefinition {
  const limits = {
    maxBlockBytes: options.maxBlockBytes ?? 1024 * 1024,
    maxBufferBytes: options.maxBufferBytes ?? 8 * 1024 * 1024,
    maxTransferBytes: options.maxTransferBytes ?? 64 * 1024 * 1024,
    maxReadOperations: options.maxReadOperations ?? 1_000_000,
    maxArgumentBytes: options.maxArgumentBytes ?? 65536,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < (name === "maxTransferBytes" ? 0 : 1)) throw new RangeError(`${name} must be a ${name === "maxTransferBytes" ? "nonnegative" : "positive"} safe integer`);
  }
  const opener = options.openFile ?? openDdFile;
  const now = options.now ?? (() => performance.now());
  return { name: "dd", runtimeIdentity: commandRuntimeIdentity, description: "Copy and convert bounded byte streams and virtual files", async execute(context) {
    const caller = context;
    context.signal.throwIfAborted();
    const diagnostic = async (message: string): Promise<void> => {
      await writeBytes(context.stderr, new TextEncoder().encode(`dd: ${message}\n`), context.signal);
    };
    let plan: DdPlan;
    try {
      let argumentBytes = 0;
      for (const argument of context.args) {
        for (const character of argument) {
          const point = character.codePointAt(0)!;
          argumentBytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
          if (argumentBytes > limits.maxArgumentBytes) throw new DdError("argument limit exceeded");
        }
      }
      const argumentsValue = getCommandArguments(context);
      let rawBytes = 0;
      for (const value of argumentsValue.values) {
        rawBytes += shellValueByteLength(value);
        if (rawBytes > limits.maxArgumentBytes) throw new DdError("argument limit exceeded");
      }
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      const operands: string[] = [];
      for (let index = 0; index < argumentsValue.args.length; index++) {
        try { operands.push(decoder.decode(argumentsValue.bytes(index)!)); }
        catch { throw new DdError("operand contains invalid UTF-8 bytes; byte-path operands are not supported"); }
      }
      const parsed = parseDd(operands);
      if (parsed === "help" || parsed === "version") {
        await writeBytes(context.stdout, new TextEncoder().encode(parsed === "help" ? help : "dd (virtual-bash GNU-compatible profile)\n"), context.signal);
        return { exitCode: 0 };
      }
      plan = parsed;
      for (const warning of plan.warnings) await diagnostic(warning);
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof DdError) for (const warning of error.warnings) await diagnostic(warning);
      await diagnostic(errorMessage(error));
      if (error instanceof DdError && error.usage) await writeBytes(context.stderr, new TextEncoder().encode("Try 'dd --help' for more information.\n"), context.signal);
      return { exitCode: 1 };
    }
    const operation = plan.output === undefined ? createOutputOperation(context, context.stdout) : undefined;
    if (operation) context = { ...context, signal: operation.signal, stdout: operation.output };
    const handles: { opening: Promise<DdFileHandle>; request: DdFileRequest }[] = [];
    let cleanup: Promise<void> | undefined;
    let closeFailure: { reason: unknown; request: DdFileRequest; handle: DdFileHandle } | undefined;
    let closeDiagnosed = false;
    let closed = false;
    const close = (): Promise<void> => {
      closed = true;
      cleanup ??= (async () => {
        for (const { opening, request } of handles) {
          let handle: DdFileHandle;
          try { handle = await opening; } catch { continue; }
          try { await handle.close(); } catch (reason) { closeFailure ??= { reason, request, handle }; }
        }
        if (closeFailure) throw closeFailure.reason;
      })();
      return cleanup;
    };
    context.registerCleanup?.(async () => {
      try { await close(); }
      catch (error) { if (!closeDiagnosed) throw error; }
    });
    const acquire = (request: DdFileRequest): Promise<DdFileHandle> => {
      context.signal.throwIfAborted();
      if (closed) throw new FsError("EBADF");
      if (request.direction === "output" && request.path !== undefined) assertCountedFileOutput(context);
      const opening = Promise.resolve().then(() => opener(context, request));
      handles.push({ opening, request });
      return opening;
    };
    let reporter: DdReporter | undefined;
    let syncOutput: DdFileHandle | undefined;
    let failure: { reason: unknown } | undefined;
    let exitCode = 0;
    let stage = "";
    try {
      const copying = plan.count !== 0n;
      if (copying && [plan.ibs, plan.obs, ...(plan.convert.has("block") || plan.convert.has("unblock") ? [plan.cbs] : [])].some(size => size > BigInt(limits.maxBlockBytes))) throw new DdError("block size limit exceeded");
      const ibs = Number(plan.ibs > BigInt(limits.maxBlockBytes) ? BigInt(limits.maxBlockBytes) : plan.ibs);
      const obs = Number(plan.obs > BigInt(limits.maxBlockBytes) ? BigInt(limits.maxBlockBytes) : plan.obs);
      const sync = plan.convert.has("fsync") ? "all" : plan.convert.has("fdatasync") ? "data" : undefined;
      const initialSeek = plan.seek * (plan.seekBytes ? 1n : plan.obs);
      if (initialSeek > BigInt(limits.maxTransferBytes)) throw new DdError("output offset limit exceeded");
      const common = { maxBufferBytes: limits.maxBufferBytes, maxReadOperations: limits.maxReadOperations };
      stage = `failed to open ${quote(plan.input ?? "standard input")}`;
      const input = await acquire({ ...common, direction: "input", ...(plan.input === undefined ? {} : { path: plan.input }), flags: plan.inputFlags,
        creation: "never", truncate: false, seek: 0n, blockSize: ibs });
      stage = `failed to open ${quote(plan.output ?? "standard output")}`;
      const output = await acquire({ ...common, direction: "output", ...(plan.output === undefined ? {} : { path: plan.output }), flags: plan.outputFlags,
        creation: plan.convert.has("excl") ? "exclusive" : plan.convert.has("nocreat") ? "never" : "allow",
        truncate: !plan.convert.has("notrunc") && initialSeek === 0n, seek: initialSeek,
        ...(sync === undefined ? {} : { synchronization: sync }), blockSize: obs });
      syncOutput = output;
      reporter = new DdReporter(context, plan.status, now);
      const report = reporter;
      const fsOptions = { signal: context.signal };
      let position = initialSeek;
      let lastSparse = false;
      const appendFile = plan.output !== undefined && plan.outputFlags.has("append") && output.type === "file";
      const deferredAppendSeek = appendFile && !output.seek && output.truncate !== undefined && output.getSize !== undefined;
      let appendPositionKnown = true;
      if (initialSeek) {
        stage = `${quote(plan.output ?? "standard output")}: cannot seek`;
        const appendIgnoresInitialPosition = appendFile && (!plan.convert.has("sparse") || deferredAppendSeek);
        if (!output.seek && !appendIgnoresInitialPosition) throw new FsError("ENOTSUP");
        if (!plan.convert.has("notrunc") && plan.output !== undefined) {
          if (!output.truncate) throw new DdError("output truncation: Operation not supported");
          await output.truncate(initialSeek, fsOptions);
        }
        await output.seek?.(initialSeek, fsOptions);
      }
      let readOperations = 0;
      let inputBytes = 0n;
      let inputPosition = 0n;
      let previousShort = 0;
      let partialRecord = 0;
      let warned = false;
      const read = async (size: number): Promise<Uint8Array> => {
        context.signal.throwIfAborted();
        if (++readOperations > limits.maxReadOperations) throw new DdError("input operation limit exceeded");
        if (!input.read) throw new FsError("EBADF");
        const bytes = await input.read(size, fsOptions);
        if (!(bytes instanceof Uint8Array) || bytes.length > size) throw new DdError("input reader returned an invalid byte block");
        inputBytes += BigInt(bytes.length);
        inputPosition += BigInt(bytes.length);
        if (inputBytes > BigInt(limits.maxTransferBytes)) throw new DdError("input transfer limit exceeded");
        return bytes;
      };
      stage = `error reading ${quote(plan.input ?? "standard input")}`;
      let skipRecords = plan.skipBytes ? plan.skip / plan.ibs : plan.skip;
      let skipRemainder = plan.skipBytes ? plan.skip % plan.ibs : 0n;
      const skipOffset = plan.skip * (plan.skipBytes ? 1n : plan.ibs);
      if (skipOffset && input.seek) {
        await input.seek(skipOffset, fsOptions);
        inputPosition = skipOffset;
        if (input.size !== undefined && input.size < skipOffset && plan.status !== "none") await diagnostic(`${quote(plan.input ?? "standard input")}: cannot skip to specified offset`);
      } else if (skipOffset) {
        let skipped = 0n;
        while (skipRecords || skipRemainder) {
          const wanted = skipRecords ? ibs : Number(skipRemainder);
          let consumed = 0;
          do {
            const chunk = await read(wanted - consumed);
            if (!chunk.length) break;
            consumed += chunk.length;
          } while (plan.inputFlags.has("fullblock") && consumed < wanted);
          if (consumed === 0) break;
          skipped += BigInt(consumed);
          if (skipRecords) skipRecords--;
          else skipRemainder = 0n;
          await yieldTurn(context.signal);
        }
        if (skipped < skipOffset && plan.status !== "none") await diagnostic(`${quote(plan.input ?? "standard input")}: cannot skip to specified offset`);
      }
      const writeRecord = async (bytes: Uint8Array, fullBuffer = false): Promise<void> => {
        stage = `${fullBuffer ? "writing to" : "error writing"} ${quote(plan.output ?? "standard output")}`;
        if (report.stats.bytes + BigInt(bytes.length) > BigInt(limits.maxTransferBytes)) throw new DdError("output transfer limit exceeded");
        lastSparse = false;
        let written = 0;
        let complete = false;
        const sparseTarget = output.type === "character" || output.type === "file" && output.size !== undefined
          && (output.truncate !== undefined || position + BigInt(bytes.length) <= output.size);
        const zeroRecord = plan.convert.has("sparse") && bytes.every(byte => byte === 0);
        if (zeroRecord && (output.seek || deferredAppendSeek) && sparseTarget && appendFile && !appendPositionKnown) {
          if (!output.getPosition) throw new DdError("sparse append cursor: Operation not supported");
          const cursor = await output.getPosition(fsOptions);
          context.signal.throwIfAborted();
          if (typeof cursor !== "bigint" || cursor < 0n) throw new FsError("EIO");
          position = cursor;
          appendPositionKnown = true;
        }
        if (position + BigInt(bytes.length) > BigInt(limits.maxTransferBytes)) throw new DdError("output offset limit exceeded");
        if (zeroRecord && (output.seek || deferredAppendSeek) && sparseTarget) {
          try {
            const seek = async (): Promise<number> => { await output.seek?.(position + BigInt(bytes.length), fsOptions); return bytes.length; };
            written = plan.output === undefined ? await seek() : await writeFileOutputCounted(context, bytes, seek);
            lastSparse = true;
          }
          catch (error) { context.signal.throwIfAborted(); if (!(error instanceof FsError) || !["ENOTSUP", "EINVAL", "ESPIPE"].includes(error.code)) throw error; }
        }
        try {
          while (written < bytes.length) {
            const count = await writeDdOutput(context, output, bytes.subarray(written), fsOptions, plan.output !== undefined);
            if (!Number.isSafeInteger(count) || count < 0 || count > bytes.length - written) throw new FsError("EIO");
            if (count === 0) throw new FsError("ENOSPC");
            written += count;
            if (appendFile) appendPositionKnown = false;
          }
          complete = true;
        } finally {
          report.stats.bytes += BigInt(written);
          position += BigInt(written);
          if (complete || plan.twoBuffers) {
            if (written === obs) report.stats.outputFull++;
            else if (written) report.stats.outputPartial++;
          }
        }
        await yieldTurn(context.signal);
      };
      const outputBuffer = new Uint8Array(copying && plan.twoBuffers ? obs : 0);
      let used = 0;
      const emit = async (bytes: Uint8Array): Promise<void> => {
        if (!plan.twoBuffers) { await writeRecord(bytes); return; }
        for (let offset = 0; offset < bytes.length;) {
          const count = Math.min(obs - used, bytes.length - offset);
          outputBuffer.set(bytes.subarray(offset, offset + count), used);
          offset += count; used += count;
          if (used === obs) { await writeRecord(outputBuffer, true); used = 0; }
        }
      };
      const converter = copying && plan.twoBuffers ? new DdConverter(plan, report.stats, emit, Math.min(obs, 65536)) : undefined;
      const maxRecords = plan.count === undefined ? undefined : plan.countBytes ? plan.count / plan.ibs : plan.count;
      const finalBytes = plan.countBytes && plan.count !== undefined ? Number(plan.count % plan.ibs) : 0;
      while (copying) {
        await report.progress();
        const records = report.stats.inputFull + report.stats.inputPartial;
        if (maxRecords !== undefined && records >= maxRecords + BigInt(finalBytes > 0)) break;
        const wanted = maxRecords !== undefined && records >= maxRecords ? finalBytes : ibs;
        stage = `error reading ${quote(plan.input ?? "standard input")}`;
        const start = inputPosition;
        const block = new Uint8Array(ibs);
        if (plan.convert.has("sync") && (plan.convert.has("block") || plan.convert.has("unblock"))) block.fill(32);
        let length = 0;
        let failedRead = false;
        try {
          do {
            const fragment = await read(wanted - length);
            if (!fragment.length) break;
            block.set(fragment, length);
            length += fragment.length;
          } while (plan.inputFlags.has("fullblock") && length < wanted);
        } catch (error) {
          context.signal.throwIfAborted();
          previousShort = 0;
          if (error instanceof DdError || !plan.convert.has("noerror")) {
            if (!(error instanceof DdError)) { await diagnostic(`${stage}: ${errorMessage(error)}`); exitCode = 1; break; }
            throw error;
          }
          if (plan.status !== "none") await diagnostic(`${stage}: ${errorMessage(error)}`);
          await report.report();
          if (input.seek) {
            const recoveredOffset = start + plan.ibs - BigInt(partialRecord);
            await input.seek(recoveredOffset, fsOptions);
            inputPosition = recoveredOffset;
          } else if (input.type !== "fifo") throw new DdError(`${quote(plan.input ?? "standard input")}: read-error recovery not supported by this input`);
          failedRead = true;
          if (!plan.convert.has("sync") || partialRecord !== 0) { await yieldTurn(context.signal); continue; }
        }
        if (!length && !failedRead) break;
        if (previousShort && !warned && length && !plan.twoBuffers && !plan.inputFlags.has("fullblock") && (plan.skip > 0n || plan.count !== undefined && plan.count > 0n)) {
          if (plan.status !== "none") await diagnostic(`warning: partial read (${previousShort} byte${previousShort === 1 ? "" : "s"}); suggest iflag=fullblock`);
          warned = true;
        }
        previousShort = length < ibs ? length : 0;
        partialRecord = failedRead ? 0 : previousShort;
        if (length === ibs) report.stats.inputFull++;
        else report.stats.inputPartial++;
        const chunk = block.subarray(0, plan.convert.has("sync") ? ibs : length);
        if (converter) await converter.push(chunk);
        else await emit(chunk);
        await yieldTurn(context.signal);
      }
      await converter?.finish();
      if (used) { await writeRecord(outputBuffer.subarray(0, used)); used = 0; }
      if (lastSparse && output.type === "file") {
        const currentSize = output.getSize ? await output.getSize(fsOptions) : output.size ?? 0n;
        context.signal.throwIfAborted();
        if (typeof currentSize !== "bigint" || currentSize < 0n) throw new FsError("EIO");
        if (currentSize < position) {
          if (!output.truncate) throw new DdError("sparse output extension: Operation not supported");
          await output.truncate(position, fsOptions);
        }
      }
    } catch (error) {
      try {
        caller.signal.throwIfAborted();
        if (operation?.signal.aborted && operation.signal.reason instanceof FsError && operation.signal.reason.code === "EPIPE") exitCode = 141;
        else {
          context.signal.throwIfAborted();
          exitCode = 1;
          await diagnostic(error instanceof DdError ? error.message : `${stage}: ${errorMessage(error)}`);
        }
      } catch (reason) { failure = { reason }; }
    }
    try {
      if (!context.signal.aborted && syncOutput) {
        let metadata = plan.convert.has("fsync");
        if (plan.convert.has("fdatasync")) {
          try {
            if (!syncOutput.sync) throw new FsError("ENOTSUP");
            await syncOutput.sync(true, { signal: context.signal });
          } catch (error) {
            context.signal.throwIfAborted();
            metadata = true;
            if (!(error instanceof FsError) || !["ENOSYS", "EINVAL"].includes(error.code)) {
              exitCode = 1;
              await diagnostic(`fdatasync failed for ${quote(plan.output ?? "standard output")}: ${errorMessage(error)}`);
            }
          }
        }
        if (metadata) {
          try {
            if (!syncOutput.sync) throw new FsError("ENOTSUP");
            await syncOutput.sync(false, { signal: context.signal });
          } catch (error) {
            context.signal.throwIfAborted();
            exitCode = 1;
            await diagnostic(`fsync failed for ${quote(plan.output ?? "standard output")}: ${errorMessage(error)}`);
          }
        }
      }
    } catch (reason) { failure ??= { reason }; }
    try { await close(); }
    catch (error) {
      if (!context.signal.aborted && !failure) {
        exitCode = 1;
        const subject = closeFailure ? `${closeFailure.request.direction} file ${quote(closeFailure.request.path ?? `standard ${closeFailure.request.direction}`)}` : "file";
        try {
          await diagnostic(`closing ${subject}: ${errorMessage(error)}`);
          caller.signal.throwIfAborted();
          context.signal.throwIfAborted();
          closeFailure?.handle.acknowledgeCloseFailure?.(closeFailure.reason);
          closeDiagnosed = true;
        }
        catch (reason) { failure = { reason }; }
      }
    }
    try { await operation?.close(); }
    catch (reason) { failure ??= { reason }; }
    caller.signal.throwIfAborted();
    if (failure) throw failure.reason;
    if (exitCode === 141) return { exitCode };
    context.signal.throwIfAborted();
    if (!closeFailure) await reporter?.report();
    return { exitCode };
  } };
}

export function createDdCommands(options: DdCommandsOptions = {}): readonly CommandDefinition[] {
  return [createDdCommand(options)];
}

export function ddCommands(options: DdCommandsOptions = {}): VirtualShellPlugin {
  const command = createDdCommand(options);
  return { name: "dd-commands", setup(host) {
    host.commands.register(command, { replace: options.replace ?? false });
  } };
}
