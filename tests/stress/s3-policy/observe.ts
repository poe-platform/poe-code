import { createS3Transport, MockS3Client, S3FileSystem } from "../../../src/fs/s3/index.js";

const Bucket = "rename-limitations";
const bytes = (value: string) => new TextEncoder().encode(value);

async function sameContentRecreation() {
  const client = new MockS3Client({ buckets: [Bucket] });
  await client.putObject({ Bucket, Key: "source", Body: bytes("identical"), Metadata: { generation: "old" } });
  const original = await client.headObject({ Bucket, Key: "source" });
  const base = createS3Transport(client, client.capabilities);
  let replacementETag: string | undefined;
  const fs = new S3FileSystem({ bucket: Bucket, transport: {
    ...base,
    async deleteObject(input, options) {
      await client.deleteObject({ Bucket, Key: input.Key });
      await client.putObject({ Bucket, Key: input.Key, Body: bytes("identical"), Metadata: { generation: "new" } });
      replacementETag = (await client.headObject({ Bucket, Key: input.Key })).ETag;
      return base.deleteObject(input, options);
    },
  } });
  let error: unknown;
  try { await fs.rename("/source", "/target"); } catch (caught) { error = caught; }
  const keys = (await client.listObjectsV2({ Bucket })).Contents?.map(item => item.Key);
  return {
    scenario: "same bytes, newly recreated source and different metadata before delete",
    resolved: error === undefined, error: error instanceof Error ? error.message : null,
    originalETag: original.ETag, replacementETag, keys,
    targetMetadata: (await client.headObject({ Bucket, Key: "target" })).Metadata,
    limitation: "ETag preconditions do not identify an object incarnation; source replacement can be deleted when its content ETag is unchanged",
  };
}

async function sourceChildAfterEnumeration() {
  const client = new MockS3Client({ buckets: [Bucket] });
  await client.putObject({ Bucket, Key: "source/old", Body: bytes("old") });
  const base = createS3Transport(client, client.capabilities);
  const fs = new S3FileSystem({ bucket: Bucket, transport: {
    ...base,
    async deleteObject(input, options) {
      await client.putObject({ Bucket, Key: "source/new", Body: bytes("new") });
      return base.deleteObject(input, options);
    },
  } });
  let error: unknown;
  try { await fs.rename("/source", "/target"); } catch (caught) { error = caught; }
  return {
    scenario: "new source child after enumeration",
    resolved: error === undefined, error: error instanceof Error ? error.message : null,
    keys: (await client.listObjectsV2({ Bucket })).Contents?.map(item => item.Key),
    limitation: "enumerated keys moved but newly added source keys remain; success is not a directory snapshot or proof source path vanished",
  };
}

console.log(JSON.stringify({ category: "documented limitations, not acceptance passes", observations: [await sameContentRecreation(), await sourceChildAfterEnumeration()] }));
