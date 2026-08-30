import { createHash } from "node:crypto";
import { collectBytes } from "../../contracts/io.js";
import { recordMockS3Head } from "./authority.js";
import { S3ServiceError } from "./transport.js";
function compareKeys(left, right) {
    return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
export class MockS3Client {
    capabilities = Object.freeze({ conditionalPut: true, conditionalCopy: true, conditionalDelete: true, streamingRead: true, streamingWrite: true });
    buckets = new Map();
    cursors = new Map();
    history = [];
    pageSize;
    now;
    authorize;
    nextToken = 0;
    constructor(options) {
        this.pageSize = options.pageSize ?? 1000;
        if (!Number.isInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > 1000) {
            throw new RangeError("pageSize must be an integer from 1 to 1000");
        }
        this.now = options.now ?? (() => new Date());
        this.authorize = options.authorize;
        for (const bucket of options.buckets)
            this.buckets.set(bucket, new Map());
    }
    get requests() {
        return structuredClone(this.history);
    }
    async begin(operation, input, options) {
        if (options?.abortSignal?.aborted)
            throw new S3ServiceError("AbortError", 499);
        const request = { operation, input: structuredClone(input) };
        this.history.push(structuredClone(request));
        await this.authorize?.(request);
        if (options?.abortSignal?.aborted)
            throw new S3ServiceError("AbortError", 499);
        if (!this.buckets.has(input.Bucket))
            throw new S3ServiceError("NoSuchBucket", 404);
        if ("Key" in input && (input.Key.length === 0 || Buffer.byteLength(input.Key) > 1024)) {
            throw new S3ServiceError("InvalidArgument", 400);
        }
    }
    bucket(name) {
        const bucket = this.buckets.get(name);
        if (!bucket)
            throw new S3ServiceError("NoSuchBucket", 404);
        return bucket;
    }
    object(input) {
        const object = this.bucket(input.Bucket).get(input.Key);
        if (!object)
            throw new S3ServiceError("NoSuchKey", 404);
        return object;
    }
    head(object) {
        return {
            ContentLength: object.body.byteLength,
            ETag: object.etag,
            LastModified: new Date(object.modified),
            Metadata: { ...object.metadata },
        };
    }
    store(body, metadata = {}) {
        const metadataBytes = Object.entries(metadata).reduce((total, [key, value]) => total + Buffer.byteLength(key) + Buffer.byteLength(value), 0);
        if (metadataBytes > 2048)
            throw new S3ServiceError("MetadataTooLarge", 400);
        return {
            body: new Uint8Array(body),
            etag: `"${createHash("md5").update(body).digest("hex")}"`,
            modified: new Date(this.now()),
            metadata: { ...metadata },
        };
    }
    async headObject(input, options) {
        await this.begin("headObject", input, options);
        const output = this.head(this.object(input));
        recordMockS3Head(output, input, this.bucket(input.Bucket));
        return output;
    }
    async getObject(input, options) {
        await this.begin("getObject", input, options);
        const object = this.object(input);
        return { ...this.head(object), Body: new Uint8Array(object.body) };
    }
    async putObject(input, options) {
        if (!(input.Body instanceof Uint8Array))
            throw new S3ServiceError("InvalidArgument", 400);
        input = { ...input, Body: new Uint8Array(input.Body), ...(input.Metadata ? { Metadata: { ...input.Metadata } } : {}) };
        await this.begin("putObject", input, options);
        const bucket = this.bucket(input.Bucket);
        const previous = bucket.get(input.Key);
        if (input.IfMatch !== undefined && !previous)
            throw new S3ServiceError("NoSuchKey", 404);
        if ((input.IfNoneMatch === "*" && previous)
            || (input.IfMatch !== undefined && previous?.etag !== input.IfMatch)) {
            throw new S3ServiceError("PreconditionFailed", 412);
        }
        const object = this.store(input.Body, input.Metadata);
        bucket.set(input.Key, object);
        return { ETag: object.etag };
    }
    async getObjectStream(input, options) {
        await this.begin("getObject", input, options);
        const object = this.object(input);
        if (input.IfMatch !== undefined && input.IfMatch !== object.etag)
            throw new S3ServiceError("PreconditionFailed", 412);
        let start = 0;
        let end = object.body.length;
        if (input.Range !== undefined) {
            const range = /^bytes=(\d+)-(\d+)$/.exec(input.Range);
            if (!range)
                throw new S3ServiceError("InvalidArgument", 400);
            start = Number(range[1]);
            end = Math.min(Number(range[2]) + 1, end);
            if (start >= end)
                throw new S3ServiceError("InvalidRange", 416);
        }
        return {
            ...this.head(object), ContentLength: end - start,
            Body: (async function* () {
                for (let offset = start; offset < end; offset += 64 * 1024) {
                    if (options?.abortSignal?.aborted)
                        throw new S3ServiceError("AbortError", 499);
                    yield object.body.slice(offset, Math.min(offset + 64 * 1024, end));
                }
            })(),
        };
    }
    async putObjectStream(input, options) {
        const snapshot = { ...input, Body: new Uint8Array(), ...(input.Metadata ? { Metadata: { ...input.Metadata } } : {}) };
        await this.begin("putObject", snapshot, options);
        const body = await collectBytes(input.Body, { maxBytes: 5_000_000_000, ...(options?.abortSignal ? { signal: options.abortSignal } : {}) });
        const bucket = this.bucket(input.Bucket);
        const previous = bucket.get(input.Key);
        if (input.IfMatch !== undefined && !previous)
            throw new S3ServiceError("NoSuchKey", 404);
        if ((input.IfNoneMatch === "*" && previous) || (input.IfMatch !== undefined && previous?.etag !== input.IfMatch)) {
            throw new S3ServiceError("PreconditionFailed", 412);
        }
        const object = this.store(body, snapshot.Metadata);
        bucket.set(input.Key, object);
        return { ETag: object.etag };
    }
    async deleteObject(input, options) {
        await this.begin("deleteObject", input, options);
        const bucket = this.bucket(input.Bucket);
        const previous = bucket.get(input.Key);
        if (input.IfMatch !== undefined && !previous)
            throw new S3ServiceError("NoSuchKey", 404);
        if (previous && input.IfMatch !== undefined && input.IfMatch !== "*" && previous.etag !== input.IfMatch) {
            throw new S3ServiceError("PreconditionFailed", 412);
        }
        bucket.delete(input.Key);
        return {};
    }
    async copyObject(input, options) {
        await this.begin("copyObject", input, options);
        let decoded;
        try {
            decoded = decodeURIComponent(input.CopySource.replace(/^\//, ""));
        }
        catch {
            throw new S3ServiceError("InvalidArgument", 400);
        }
        const separator = decoded.indexOf("/");
        if (separator < 1)
            throw new S3ServiceError("InvalidArgument", 400);
        const source = this.object({ Bucket: decoded.slice(0, separator), Key: decoded.slice(separator + 1) });
        if (input.CopySourceIfMatch !== undefined && input.CopySourceIfMatch !== source.etag) {
            throw new S3ServiceError("PreconditionFailed", 412);
        }
        const bucket = this.bucket(input.Bucket);
        if (input.IfNoneMatch === "*" && bucket.has(input.Key))
            throw new S3ServiceError("PreconditionFailed", 412);
        if (input.IfMatch !== undefined && bucket.get(input.Key)?.etag !== input.IfMatch)
            throw new S3ServiceError("PreconditionFailed", 412);
        const copy = this.store(source.body, input.MetadataDirective === "REPLACE" ? input.Metadata : source.metadata);
        bucket.set(input.Key, copy);
        return { CopyObjectResult: { ETag: copy.etag, LastModified: new Date(copy.modified) } };
    }
    async listObjectsV2(input, options) {
        await this.begin("listObjectsV2", input, options);
        const maxKeys = input.MaxKeys ?? 1000;
        if (!Number.isInteger(maxKeys) || maxKeys < 0 || maxKeys > 1000)
            throw new S3ServiceError("InvalidArgument", 400);
        const prefix = input.Prefix ?? "";
        const delimiter = input.Delimiter ?? "";
        const scope = JSON.stringify([input.Bucket, prefix, delimiter]);
        const cursor = input.ContinuationToken === undefined ? undefined : this.cursors.get(input.ContinuationToken);
        if (input.ContinuationToken !== undefined && (!cursor || cursor.scope !== scope)) {
            throw new S3ServiceError("InvalidArgument", 400, "invalid continuation token");
        }
        const entries = new Map();
        for (const [key, object] of this.bucket(input.Bucket)) {
            if (!key.startsWith(prefix))
                continue;
            const separator = delimiter === "" ? -1 : key.indexOf(delimiter, prefix.length);
            if (separator >= 0) {
                const commonPrefix = key.slice(0, separator + delimiter.length);
                entries.set(commonPrefix, commonPrefix);
            }
            else {
                entries.set(key, { Key: key, Size: object.body.byteLength, ETag: object.etag, LastModified: new Date(object.modified) });
            }
        }
        const ordered = [...entries.keys()].sort(compareKeys)
            .filter((key) => cursor === undefined || compareKeys(key, cursor.after) > 0);
        const selected = ordered.slice(0, Math.min(maxKeys, this.pageSize));
        const contents = [];
        const prefixes = [];
        for (const key of selected) {
            const entry = entries.get(key);
            if (typeof entry === "string")
                prefixes.push({ Prefix: entry });
            else if (entry)
                contents.push(entry);
        }
        const truncated = maxKeys > 0 && selected.length < ordered.length;
        let token;
        if (truncated) {
            token = `mock-s3-cursor-${++this.nextToken}`;
            this.cursors.set(token, { scope, after: selected[selected.length - 1] });
        }
        return {
            Contents: contents,
            CommonPrefixes: prefixes,
            KeyCount: selected.length,
            IsTruncated: truncated,
            ...(token === undefined ? {} : { NextContinuationToken: token }),
        };
    }
}
//# sourceMappingURL=mock.js.map