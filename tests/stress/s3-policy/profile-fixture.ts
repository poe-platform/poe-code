import assert from "node:assert/strict";
import {
  createS3Transport, MockS3Client, S3FileSystem, S3ServiceError,
  type S3CopyInput, type S3DeleteInput, type S3PutInput,
} from "../../../src/fs/s3/index.js";
import type { S3StreamPutInput } from "../../../src/fs/s3/transport.js";

export type Profile = "modern-copy" | "classic-put" | "stream-put";
export type Mutation = { operation: "copy"; input: S3CopyInput }
  | { operation: "put"; input: S3PutInput } | { operation: "stream-put"; input: S3StreamPutInput }
  | { operation: "delete"; input: S3DeleteInput };
export const bucket = "bounded-rename-policy";
export const binary = (value: string) => new TextEncoder().encode(value);

export async function profileFixture(profile: Profile, initial: Record<string, string>, maxReadBytes = 4096) {
  const client = new MockS3Client({ buckets: [bucket], pageSize: 2, now: () => new Date(1_700_000_000_000) });
  for (const [Key, value] of Object.entries(initial)) {
    await client.putObject({ Bucket: bucket, Key, Body: binary(value), Metadata: { origin: "seed" } });
  }
  const capabilities = { conditionalCopy: profile === "modern-copy", conditionalPut: profile !== "modern-copy", conditionalDelete: true,
    streamingRead: profile === "stream-put", streamingWrite: profile === "stream-put" };
  const base = createS3Transport(client, capabilities);
  const mutations: Mutation[] = [];
  const reads = { buffered: 0, streaming: 0 };
  let before: (mutation: Mutation) => Promise<void> = async () => {};
  let after: (mutation: Mutation) => Promise<void> = async () => {};
  const fs = new S3FileSystem({ bucket, pageSize: 2, maxReadBytes, transport: {
    ...base,
    async getObject(input, options) {
      reads.buffered++;
      return base.getObject(input, options);
    },
    async getObjectStream(input, options) {
      reads.streaming++;
      return base.getObjectStream!(input, options);
    },
    async copyObject(input, options) {
      const mutation: Mutation = { operation: "copy", input: structuredClone(input) };
      mutations.push(mutation);
      if (!capabilities.conditionalCopy && (input.IfMatch !== undefined || input.IfNoneMatch !== undefined)) {
        throw new S3ServiceError("NotImplemented", 501, "profile does not support destination conditions on CopyObject");
      }
      await before(mutation);
      const output = await base.copyObject(input, options);
      await after(mutation);
      return output;
    },
    async putObject(input, options) {
      const mutation: Mutation = { operation: "put", input: structuredClone(input) };
      mutations.push(mutation);
      if (!capabilities.conditionalPut && (input.IfMatch !== undefined || input.IfNoneMatch !== undefined)) {
        throw new S3ServiceError("NotImplemented", 501, "profile does not support conditional PutObject");
      }
      await before(mutation);
      const output = await base.putObject(input, options);
      await after(mutation);
      return output;
    },
    async putObjectStream(input, options) {
      const mutation: Mutation = { operation: "stream-put", input: { ...input } };
      mutations.push(mutation);
      if (!capabilities.streamingWrite || !capabilities.conditionalPut) {
        throw new S3ServiceError("NotImplemented", 501, "profile does not support conditional streaming publication");
      }
      await before(mutation);
      const output = await base.putObjectStream!(input, options);
      await after(mutation);
      return output;
    },
    async deleteObject(input, options) {
      const mutation: Mutation = { operation: "delete", input: structuredClone(input) };
      mutations.push(mutation);
      await before(mutation);
      const output = await base.deleteObject(input, options);
      await after(mutation);
      return output;
    },
  } });
  return {
    client, fs, mutations, reads,
    before(hook: typeof before) { before = hook; },
    after(hook: typeof after) { after = hook; },
    async actorPut(Key: string, value: string, metadata: Record<string, string> = { writer: "concurrent" }) {
      await client.putObject({ Bucket: bucket, Key, Body: binary(value), Metadata: metadata });
    },
    async actorDelete(Key: string) { await client.deleteObject({ Bucket: bucket, Key }); },
    async state() {
      const result: Record<string, { text: string; metadata: Record<string, string> | undefined; etag: string | undefined }> = {};
      let token: string | undefined;
      do {
        const page = await client.listObjectsV2({ Bucket: bucket, ...(token ? { ContinuationToken: token } : {}) });
        for (const item of page.Contents ?? []) {
          assert.ok(item.Key);
          const object = await client.getObject({ Bucket: bucket, Key: item.Key });
          assert.ok(object.Body instanceof Uint8Array);
          result[item.Key] = { text: new TextDecoder().decode(object.Body), metadata: object.Metadata, etag: object.ETag };
        }
        token = page.NextContinuationToken;
      } while (token);
      return result;
    },
  };
}

export async function renameOutcome(fs: S3FileSystem, signal?: AbortSignal): Promise<unknown> {
  try { await fs.rename("/source", "/target", signal ? { signal } : {}); return undefined; }
  catch (error) { return error; }
}
