import { isIP } from "node:net";
import { S3ServiceError } from "../transport.js";
import { abortable, collect, limitedBody, scopeFor, sendRequest } from "./request.js";
import { canonicalQuery, headerValue, invalid, signRequest, uriEncode } from "./signature.js";
import { children, integer, malformed, parseXml, text, timestamp } from "./xml.js";
const empty = new Uint8Array();
function limit(value, fallback, name, maximum = 1024 * 1024 * 1024) {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
        invalid(`invalid ${name}`);
    return result;
}
function boolean(value, fallback, name) {
    if (value !== undefined && typeof value !== "boolean")
        invalid(`invalid ${name}`);
    return value ?? fallback;
}
function bucketName(bucket) {
    if (typeof bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
        || bucket.includes("..") || bucket.includes(".-") || bucket.includes("-.") || isIP(bucket))
        invalid("expected a standard S3 bucket name");
}
function objectKey(key) {
    if (typeof key !== "string" || !key || Buffer.byteLength(key) > 1024)
        invalid("object keys must contain 1..1024 UTF-8 bytes");
    uriEncode(key);
}
function header(message, name) {
    const values = message.headersDistinct[name];
    if (values && values.length !== 1)
        malformed(`duplicate ${name} header`);
    return values?.[0];
}
function head(message) {
    const length = header(message, "content-length");
    const modified = header(message, "last-modified");
    const etag = header(message, "etag");
    const metadata = Object.create(null);
    for (const name of Object.keys(message.headersDistinct)) {
        if (name.startsWith("x-amz-meta-"))
            metadata[name.slice(11)] = header(message, name);
    }
    return {
        ...(length === undefined ? {} : { ContentLength: integer(length) }),
        ...(modified === undefined ? {} : { LastModified: timestamp(modified) }),
        ...(etag === undefined ? {} : { ETag: etag }),
        Metadata: metadata,
    };
}
function metadataHeaders(metadata) {
    const headers = Object.create(null);
    let size = 0;
    for (const [name, value] of Object.entries(metadata ?? {})) {
        const lower = name.toLowerCase();
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(lower) || `x-amz-meta-${lower}` in headers)
            invalid("invalid or duplicate metadata key");
        const normalized = headerValue(value);
        size += Buffer.byteLength(lower) + Buffer.byteLength(normalized);
        if (size > 2048)
            invalid("metadata exceeds 2 KiB");
        headers[`x-amz-meta-${lower}`] = normalized;
    }
    return headers;
}
function conditions(input) {
    const headers = {};
    if (input.IfMatch !== undefined) {
        const value = headerValue(input.IfMatch);
        if (!value)
            invalid("empty IfMatch");
        headers["if-match"] = value;
    }
    if (input.IfNoneMatch !== undefined) {
        if (input.IfNoneMatch !== "*")
            invalid("IfNoneMatch must be '*'");
        headers["if-none-match"] = "*";
    }
    return headers;
}
function requireCondition(enabled, present) {
    if (present && !enabled)
        throw new S3ServiceError("NotImplemented", 501, "conditional operation requires independently verified provider enforcement");
}
function copySource(value) {
    if (typeof value !== "string" || value.length > 4096 || !/^\/?[A-Za-z0-9_.~!$&'()*+,;=:@%/-]+$/.test(value))
        invalid("CopySource must already be URI encoded without a query");
    const source = value.startsWith("/") ? value.slice(1) : value;
    const slash = source.indexOf("/");
    if (slash < 1)
        invalid("CopySource requires bucket/key");
    let bucket;
    let key;
    try {
        bucket = decodeURIComponent(source.slice(0, slash));
        key = decodeURIComponent(source.slice(slash + 1));
    }
    catch {
        return invalid("invalid CopySource encoding");
    }
    bucketName(bucket);
    objectKey(key);
    return value;
}
function rangeHeader(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string" || !/^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$/.test(value))
        invalid("unsupported byte range");
    const [start, end] = value.slice(6).split("-");
    if ((start && !Number.isSafeInteger(Number(start))) || (end && !Number.isSafeInteger(Number(end)))
        || (!start && Number(end) === 0) || (start && end && Number(start) > Number(end)))
        invalid("invalid byte range");
    return value;
}
function checkRange(message, range, metadata) {
    if (!range) {
        if (message.statusCode !== 200)
            malformed("unexpected GET status");
        return metadata.ContentLength;
    }
    if (message.statusCode !== 206)
        malformed("provider ignored byte range");
    const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(header(message, "content-range") ?? "");
    if (!match)
        malformed("invalid Content-Range");
    const start = integer(match[1]);
    const end = integer(match[2]);
    const total = integer(match[3]);
    const [requestedStart, requestedEnd] = range.slice(6).split("-");
    const expectedStart = requestedStart ? Number(requestedStart) : Math.max(0, total - Number(requestedEnd));
    const expectedEnd = requestedStart && requestedEnd ? Math.min(total - 1, Number(requestedEnd)) : total - 1;
    if (start !== expectedStart || end !== expectedEnd || start > end || end >= total
        || (metadata.ContentLength !== undefined && metadata.ContentLength !== end - start + 1))
        malformed("response range differs from request");
    return end - start + 1;
}
export function createS3HttpTransport(options) {
    if (!options || typeof options.endpoint !== "string" || !/^https?:\/\/[^\\/?#]+\/?$/.test(options.endpoint))
        invalid("endpoint must be an explicit HTTP(S) origin without path, credentials, query or fragment");
    let endpoint;
    try {
        endpoint = new URL(options.endpoint);
    }
    catch {
        return invalid("invalid endpoint");
    }
    if (endpoint.username || endpoint.password)
        invalid("endpoint credentials are not allowed");
    if (endpoint.protocol === "http:" && !boolean(options.allowInsecureHttp, false, "allowInsecureHttp"))
        invalid("HTTP requires explicit allowInsecureHttp");
    if (typeof options.region !== "string" || !/^[a-z0-9-]{1,64}$/.test(options.region))
        invalid("explicit signing region required");
    if (!options.credentials || (typeof options.credentials !== "function" && typeof options.credentials !== "object"))
        invalid("explicit credentials required");
    const credentials = typeof options.credentials === "function" ? options.credentials : Object.freeze({ ...options.credentials });
    const addressing = options.addressingStyle ?? "path";
    if (addressing !== "path" && addressing !== "virtual-hosted")
        invalid("unsupported addressing style");
    const listEncoding = options.listUrlEncoding ?? "percent";
    if (listEncoding !== "percent" && listEncoding !== "form")
        invalid("unsupported LIST URL encoding");
    if (addressing === "virtual-hosted" && (isIP(endpoint.hostname.replace(/^\[|\]$/g, "")) || endpoint.hostname === "localhost"))
        invalid("virtual-hosted addressing requires a DNS endpoint");
    const maxPut = limit(options.maxPutBytes, 64 * 1024 * 1024, "maxPutBytes");
    const maxGet = limit(options.maxGetBytes, 64 * 1024 * 1024, "maxGetBytes");
    const maxXml = limit(options.maxXmlBytes, 4 * 1024 * 1024, "maxXmlBytes", 16 * 1024 * 1024);
    const timeout = limit(options.requestTimeoutMs, 30_000, "requestTimeoutMs", 2_147_483_647);
    const enabledCopy = boolean(options.enableCopy, true, "enableCopy");
    const verified = options.verifiedConditionalOperations;
    const conditionalPut = boolean(verified?.put, false, "verifiedConditionalOperations.put");
    const nativeConditionalCopy = boolean(verified?.copy, false, "verifiedConditionalOperations.copy");
    const conditionalCopy = enabledCopy ? nativeConditionalCopy : conditionalPut;
    const conditionalDelete = boolean(verified?.delete, false, "verifiedConditionalOperations.delete");
    const clock = options.clock ?? (() => new Date());
    const factory = options.request;
    const region = options.region;
    if (typeof clock !== "function" || (factory !== undefined && typeof factory !== "function"))
        invalid("invalid clock or request factory");
    const exchange = async (method, bucket, key, headers, query, body, requestOptions) => {
        requestOptions?.abortSignal?.throwIfAborted();
        bucketName(bucket);
        if (key !== undefined)
            objectKey(key);
        const hostname = addressing === "virtual-hosted" ? `${bucket}.${endpoint.hostname}` : endpoint.hostname;
        const host = `${hostname}${endpoint.port ? `:${endpoint.port}` : ""}`;
        const path = addressing === "virtual-hosted" ? `/${key === undefined ? "" : uriEncode(key, true)}`
            : `/${bucket}${key === undefined ? "" : `/${uriEncode(key, true)}`}`;
        const encodedQuery = canonicalQuery(query);
        const target = `${path}${encodedQuery ? `?${encodedQuery}` : ""}`;
        if (target.length > 16 * 1024)
            invalid("request target exceeds 16 KiB");
        const scope = scopeFor(requestOptions?.abortSignal, timeout);
        try {
            scope.signal.throwIfAborted();
            const resolved = typeof credentials === "function" ? await abortable(Promise.resolve(credentials({ signal: scope.signal })), scope.signal) : credentials;
            scope.signal.throwIfAborted();
            const signed = signRequest({ method, path, query: encodedQuery,
                headers: { ...headers, host, ...(method === "PUT" ? { "content-length": String(body.length) } : {}) },
                body, region, credentials: resolved, date: clock() });
            const response = await sendRequest({ protocol: endpoint.protocol, hostname: hostname.replace(/^\[|\]$/g, ""),
                ...(endpoint.port ? { port: endpoint.port } : {}), method, path: target, headers: signed.headers,
                agent: false, maxHeaderSize: 16 * 1024, ...{ rejectUnauthorized: true } }, body, scope, factory);
            const status = response.message.statusCode ?? 502;
            if (status < 200 || status >= 300) {
                const bytes = await collect(response, maxXml);
                const fallback = status === 404 ? "NotFound" : status === 403 || status === 401 ? "AccessDenied"
                    : status === 412 ? "PreconditionFailed" : status === 409 ? "ConditionalRequestConflict"
                        : status === 501 ? "NotImplemented" : status === 408 ? "RequestTimeout" : status >= 300 && status < 400 ? "RedirectRejected" : "HttpError";
                let code = fallback;
                let message = `S3 HTTP request failed with status ${status}`;
                if (bytes.length) {
                    try {
                        const parsed = parseXml(bytes);
                        if (parsed.name === "Error") {
                            code = text(parsed, "Code") || fallback;
                            message = text(parsed, "Message") || message;
                        }
                    }
                    catch { }
                }
                throw new S3ServiceError(code, status, message);
            }
            return response;
        }
        catch (error) {
            scope.finish();
            throw scope.signal.aborted ? scope.signal.reason : error;
        }
    };
    const get = async (input, requestOptions) => {
        requestOptions?.abortSignal?.throwIfAborted();
        const range = rangeHeader(input.Range);
        const headers = { ...conditions(input), ...(range ? { range } : {}) };
        const response = await exchange("GET", input.Bucket, input.Key, headers, [], empty, requestOptions);
        try {
            const metadata = head(response.message);
            const expected = checkRange(response.message, range, metadata);
            if (input.IfMatch !== undefined && input.IfMatch !== "*" && metadata.ETag !== undefined && metadata.ETag !== input.IfMatch)
                malformed("GET ETag differs from IfMatch");
            return { ...metadata, Body: limitedBody(response, maxGet, expected) };
        }
        catch (error) {
            response.close();
            throw error;
        }
    };
    const boundedCopy = async (input, requestOptions) => {
        if (!conditionalPut)
            throw new S3ServiceError("NotImplemented", 501, "disabled native COPY requires verified conditional PUT for bounded fallback");
        const scope = scopeFor(requestOptions?.abortSignal, timeout);
        const operationOptions = { abortSignal: scope.signal };
        const destination = { Bucket: input.Bucket, Key: input.Key };
        const source = copySource(input.CopySource).replace(/^\//, "");
        const slash = source.indexOf("/");
        const origin = { Bucket: decodeURIComponent(source.slice(0, slash)), Key: decodeURIComponent(source.slice(slash + 1)) };
        const sourceCondition = input.CopySourceIfMatch;
        let destinationCondition = { ...conditions(input) };
        const directive = input.MetadataDirective ?? "COPY";
        const replacementMetadata = input.Metadata === undefined ? {} : { ...input.Metadata };
        let body;
        try {
            scope.signal.throwIfAborted();
            if (Object.keys(destinationCondition).length === 0) {
                let current;
                try {
                    current = await transport.headObject(destination, operationOptions);
                }
                catch (error) {
                    if (scope.signal.aborted)
                        throw scope.signal.reason;
                    if (!(error instanceof S3ServiceError) || !["NotFound", "NoSuchKey"].includes(error.code))
                        throw error;
                }
                if (current) {
                    if (!current.ETag)
                        malformed("destination lacks ETag for conditional COPY fallback");
                    destinationCondition = { "if-match": current.ETag };
                }
                else
                    destinationCondition = { "if-none-match": "*" };
            }
            const output = await get({ ...origin, ...(sourceCondition === undefined ? {} : { IfMatch: sourceCondition }) }, operationOptions);
            body = output.Body[Symbol.asyncIterator]();
            if (!output.ETag || output.ContentLength === undefined)
                malformed("source lacks ETag/length for bounded COPY fallback");
            if (sourceCondition !== undefined && sourceCondition !== "*" && output.ETag !== sourceCondition)
                throw new S3ServiceError("PreconditionFailed", 412, "source changed before COPY fallback");
            if (output.ContentLength > maxPut)
                throw new S3ServiceError("EntityTooLarge", 413, "COPY fallback exceeds PUT byte limit");
            const chunks = [];
            let count = 0;
            while (true) {
                const result = await body.next();
                if (result.done)
                    break;
                count += result.value.length;
                if (count > maxPut)
                    throw new S3ServiceError("EntityTooLarge", 413, "COPY fallback exceeds PUT byte limit");
                chunks.push(result.value);
            }
            scope.signal.throwIfAborted();
            const metadata = directive === "REPLACE" ? replacementMetadata : output.Metadata;
            const headers = { ...metadataHeaders(metadata), ...destinationCondition };
            const response = await exchange("PUT", destination.Bucket, destination.Key, headers, [], Buffer.concat(chunks, count), operationOptions);
            try {
                if (response.message.statusCode !== 200)
                    malformed("unexpected COPY fallback PUT status");
                await collect(response, maxXml);
                const etag = header(response.message, "etag");
                if (!etag)
                    malformed("COPY fallback PUT lacks confirmation ETag");
                return { CopyObjectResult: { ETag: etag } };
            }
            finally {
                response.close();
            }
        }
        finally {
            await body?.return?.();
            scope.finish();
        }
    };
    const transport = {
        capabilities: Object.freeze({ streamingRead: true, streamingWrite: false, conditionalPut, conditionalCopy, conditionalDelete }),
        async headObject(input, requestOptions) {
            const response = await exchange("HEAD", input.Bucket, input.Key, {}, [], empty, requestOptions);
            try {
                if (response.message.statusCode !== 200)
                    malformed("unexpected HEAD status");
                const metadata = head(response.message);
                await collect(response, maxXml);
                return metadata;
            }
            finally {
                response.close();
            }
        },
        async getObject(input, requestOptions) {
            const response = await get(input, requestOptions);
            const chunks = [];
            let count = 0;
            for await (const chunk of response.Body) {
                chunks.push(chunk);
                count += chunk.length;
            }
            return { ...response, Body: Buffer.concat(chunks, count) };
        },
        getObjectStream: get,
        async putObject(input, requestOptions) {
            requestOptions?.abortSignal?.throwIfAborted();
            if (!(input.Body instanceof Uint8Array))
                invalid("PUT requires a bounded Uint8Array");
            if (input.Body.length > maxPut)
                throw new S3ServiceError("EntityTooLarge", 413, "PUT exceeds byte limit");
            requireCondition(conditionalPut, input.IfMatch !== undefined || input.IfNoneMatch !== undefined);
            const body = new Uint8Array(input.Body);
            const headers = { ...metadataHeaders(input.Metadata), ...conditions(input) };
            const response = await exchange("PUT", input.Bucket, input.Key, headers, [], body, requestOptions);
            try {
                if (response.message.statusCode !== 200)
                    malformed("unexpected PUT status");
                await collect(response, maxXml);
                return { ETag: header(response.message, "etag") };
            }
            finally {
                response.close();
            }
        },
        async deleteObject(input, requestOptions) {
            requestOptions?.abortSignal?.throwIfAborted();
            requireCondition(conditionalDelete, input.IfMatch !== undefined);
            const response = await exchange("DELETE", input.Bucket, input.Key, conditions(input), [], empty, requestOptions);
            try {
                if (response.message.statusCode !== 204)
                    malformed("unexpected DELETE status");
                await collect(response, maxXml);
                return {};
            }
            finally {
                response.close();
            }
        },
        async copyObject(input, requestOptions) {
            requestOptions?.abortSignal?.throwIfAborted();
            if (input.MetadataDirective !== undefined && input.MetadataDirective !== "COPY" && input.MetadataDirective !== "REPLACE")
                invalid("invalid MetadataDirective");
            const headers = { ...metadataHeaders(input.Metadata), ...conditions(input), "x-amz-copy-source": copySource(input.CopySource),
                ...(input.CopySourceIfMatch === undefined ? {} : { "x-amz-copy-source-if-match": headerValue(input.CopySourceIfMatch) }),
                ...(input.MetadataDirective === undefined ? {} : { "x-amz-metadata-directive": input.MetadataDirective }) };
            if (input.CopySourceIfMatch !== undefined && !headers["x-amz-copy-source-if-match"])
                invalid("empty CopySourceIfMatch");
            bucketName(input.Bucket);
            objectKey(input.Key);
            if (!enabledCopy)
                return boundedCopy(input, requestOptions);
            requireCondition(conditionalCopy, input.IfMatch !== undefined || input.IfNoneMatch !== undefined || input.CopySourceIfMatch !== undefined);
            const response = await exchange("PUT", input.Bucket, input.Key, headers, [], empty, requestOptions);
            const root = parseXml(await collect(response, maxXml));
            if (root.name === "Error")
                throw new S3ServiceError(text(root, "Code", true), response.message.statusCode, text(root, "Message") ?? "embedded COPY failure");
            if (response.message.statusCode !== 200 || root.name !== "CopyObjectResult")
                malformed("invalid COPY response");
            return { CopyObjectResult: { ETag: text(root, "ETag", true), LastModified: timestamp(text(root, "LastModified", true)) } };
        },
        async listObjectsV2(input, requestOptions) {
            requestOptions?.abortSignal?.throwIfAborted();
            if (input.MaxKeys !== undefined && (!Number.isSafeInteger(input.MaxKeys) || input.MaxKeys < 0 || input.MaxKeys > 1000))
                invalid("MaxKeys must be 0..1000");
            const query = [["list-type", "2"], ["encoding-type", "url"]];
            for (const [name, value] of [["prefix", input.Prefix], ["delimiter", input.Delimiter], ["continuation-token", input.ContinuationToken]]) {
                if (value !== undefined) {
                    if (typeof value !== "string" || Buffer.byteLength(value) > 8192)
                        invalid(`invalid ${name}`);
                    query.push([name, value]);
                }
            }
            if (input.MaxKeys !== undefined)
                query.push(["max-keys", String(input.MaxKeys)]);
            const response = await exchange("GET", input.Bucket, undefined, {}, query, empty, requestOptions);
            const root = parseXml(await collect(response, maxXml));
            if (response.message.statusCode !== 200 || root.name !== "ListBucketResult")
                malformed("invalid LIST response");
            const encoding = text(root, "EncodingType");
            if (encoding !== undefined && encoding !== "url")
                malformed("unsupported LIST encoding");
            const decode = (value) => {
                if (encoding !== "url")
                    return value;
                try {
                    return decodeURIComponent(listEncoding === "form" ? value.replace(/\+/g, " ") : value);
                }
                catch {
                    return malformed("invalid URL-encoded LIST key");
                }
            };
            const truncated = text(root, "IsTruncated", true);
            if (truncated !== "true" && truncated !== "false")
                malformed("invalid IsTruncated");
            const token = text(root, "NextContinuationToken");
            if (truncated === "true" && !token)
                malformed("truncated LIST lacks continuation token");
            const keyCount = text(root, "KeyCount");
            const contents = children(root, "Contents").map(item => ({ Key: decode(text(item, "Key", true)),
                Size: integer(text(item, "Size", true)), ETag: text(item, "ETag", true), LastModified: timestamp(text(item, "LastModified", true)) }));
            const prefixes = children(root, "CommonPrefixes").map(item => ({ Prefix: decode(text(item, "Prefix", true)) }));
            if (contents.length + prefixes.length > (input.MaxKeys ?? 1000))
                malformed("LIST exceeds requested page size");
            return { Contents: contents, CommonPrefixes: prefixes, IsTruncated: truncated === "true",
                ...(keyCount === undefined ? {} : { KeyCount: integer(keyCount) }), ...(token === undefined ? {} : { NextContinuationToken: token }) };
        },
    };
    return Object.freeze(transport);
}
//# sourceMappingURL=transport.js.map