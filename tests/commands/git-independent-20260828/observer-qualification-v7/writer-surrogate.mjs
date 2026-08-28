export function createWriter(session, compressed, codec, GitFailure) {
  let codecError;
  let hasCodecError = false;
  codec.on("error", error => { if (!hasCodecError) { hasCodecError = true; codecError = error; } });
  const writer = async () => {
    try {
      for (let offset = 0; offset < compressed.length; offset += 4096) {
        session.check();
        await session.step(Math.min(4096, compressed.length - offset));
        await new Promise((resolve, reject) => {
          const closed = () => finish(hasCodecError ? codecError : new GitFailure("Git codec closed during write"));
          const finish = (error) => {
            codec.removeListener("close", closed);
            if (error !== undefined) reject(error); else resolve();
          };
          if (codec.destroyed) { closed(); return; }
          codec.once("close", closed);
          codec.write(compressed.subarray(offset, offset + 4096), error => finish(error ?? undefined));
        });
        if (codec.readableEnded) break;
      }
      codec.end();
    } catch (error) { codec.destroy(error instanceof Error ? error : new Error("Git codec writer stopped")); throw error; }
  };
  return writer;
}
