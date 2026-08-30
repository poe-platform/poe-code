export interface S3RequestOptions {
  readonly abortSignal?: AbortSignal;
}

export interface S3ObjectInput {
  readonly Bucket: string;
  readonly Key: string;
}

export interface S3HeadOutput {
  readonly ContentLength?: number | undefined;
  readonly LastModified?: Date | undefined;
  readonly ETag?: string | undefined;
  readonly Metadata?: Record<string, string> | undefined;
}

export type S3Body = Uint8Array | AsyncIterable<Uint8Array> | {
  transformToByteArray(): Promise<Uint8Array>;
};

export interface S3GetOutput extends S3HeadOutput {
  readonly Body?: S3Body | undefined;
}

export interface S3StreamGetInput extends S3ObjectInput {
  readonly Range?: string;
  readonly IfMatch?: string;
}

export interface S3StreamGetOutput extends S3HeadOutput {
  readonly Body: AsyncIterable<Uint8Array>;
}

export interface S3StreamPutInput extends Omit<S3PutInput, "Body"> {
  readonly Body: AsyncIterable<Uint8Array>;
}

export interface S3PutInput extends S3ObjectInput {
  readonly Body: Uint8Array;
  readonly IfMatch?: string;
  readonly IfNoneMatch?: "*";
  readonly Metadata?: Record<string, string>;
}

export interface S3DeleteInput extends S3ObjectInput {
  readonly IfMatch?: string;
}

export interface S3CopyInput extends S3ObjectInput {
  readonly CopySource: string;
  readonly CopySourceIfMatch?: string;
  readonly IfNoneMatch?: "*";
  readonly IfMatch?: string;
  readonly MetadataDirective?: "COPY" | "REPLACE";
  readonly Metadata?: Record<string, string>;
}

export interface S3CopyOutput {
  readonly CopyObjectResult?: {
    readonly ETag?: string | undefined;
    readonly LastModified?: Date | undefined;
  } | undefined;
}

export interface S3ListInput {
  readonly Bucket: string;
  readonly Prefix?: string;
  readonly Delimiter?: string;
  readonly MaxKeys?: number;
  readonly ContinuationToken?: string;
}

export interface S3ObjectSummary {
  readonly Key?: string | undefined;
  readonly Size?: number | undefined;
  readonly ETag?: string | undefined;
  readonly LastModified?: Date | undefined;
}

export interface S3ListOutput {
  readonly Contents?: readonly S3ObjectSummary[] | undefined;
  readonly CommonPrefixes?: readonly { readonly Prefix?: string | undefined }[] | undefined;
  readonly IsTruncated?: boolean | undefined;
  readonly NextContinuationToken?: string | undefined;
  readonly KeyCount?: number | undefined;
}

export interface S3Client {
  getObjectStream?(input: S3StreamGetInput, options?: S3RequestOptions): Promise<S3StreamGetOutput>;
  putObjectStream?(input: S3StreamPutInput, options?: S3RequestOptions): Promise<unknown>;
  headObject(input: S3ObjectInput, options?: S3RequestOptions): Promise<S3HeadOutput>;
  getObject(input: S3ObjectInput, options?: S3RequestOptions): Promise<S3GetOutput>;
  putObject(input: S3PutInput, options?: S3RequestOptions): Promise<unknown>;
  deleteObject(input: S3DeleteInput, options?: S3RequestOptions): Promise<unknown>;
  copyObject(input: S3CopyInput, options?: S3RequestOptions): Promise<S3CopyOutput>;
  listObjectsV2(input: S3ListInput, options?: S3RequestOptions): Promise<S3ListOutput>;
}

export interface S3TransportCapabilities {
  readonly streamingRead?: boolean;
  readonly streamingWrite?: boolean;
  readonly conditionalPut?: boolean;
  readonly conditionalCopy?: boolean;
  readonly conditionalDelete?: boolean;
}

export interface S3Transport extends S3Client {
  readonly capabilities?: S3TransportCapabilities;
}

export function createS3Transport(
  client: S3Client,
  capabilities: S3TransportCapabilities = {},
): S3Transport {
  const transport: S3Transport = {
    capabilities: Object.freeze({ ...capabilities }),
    ...(client.getObjectStream ? { getObjectStream: (input: S3StreamGetInput, options?: S3RequestOptions) => client.getObjectStream!(input, options) } : {}),
    ...(client.putObjectStream ? { putObjectStream: (input: S3StreamPutInput, options?: S3RequestOptions) => client.putObjectStream!(input, options) } : {}),
    headObject: (input, options) => client.headObject(input, options),
    getObject: (input, options) => client.getObject(input, options),
    putObject: (input, options) => client.putObject(input, options),
    deleteObject: (input, options) => client.deleteObject(input, options),
    copyObject: (input, options) => client.copyObject(input, options),
    listObjectsV2: (input, options) => client.listObjectsV2(input, options),
  };
  return transport;
}

export class S3ServiceError extends Error {
  readonly code: string;
  readonly $metadata: { readonly httpStatusCode: number };

  constructor(code: string, status: number, message = code) {
    super(message);
    this.name = code;
    this.code = code;
    this.$metadata = { httpStatusCode: status };
  }
}

export function encodeCopySource(bucket: string, key: string): string {
  return [bucket, ...key.split("/")].map((part) => encodeURIComponent(part)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}
