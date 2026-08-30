import { createHash, createHmac } from "node:crypto";
import { S3ServiceError } from "../transport.js";
export function invalid(message) {
    throw new S3ServiceError("InvalidArgument", 400, message);
}
export function uriEncode(value, preserveSlash = false) {
    if (typeof value !== "string")
        invalid("expected a UTF-8 string");
    try {
        const encoded = encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        return preserveSlash ? encoded.replace(/%2F/g, "/") : encoded;
    }
    catch {
        return invalid("invalid Unicode string");
    }
}
export function canonicalQuery(entries) {
    return entries.map(([name, value]) => [uriEncode(name), uriEncode(value)])
        .sort(([leftName, leftValue], [rightName, rightValue]) => leftName < rightName ? -1 : leftName > rightName ? 1 : leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0)
        .map(([name, value]) => `${name}=${value}`).join("&");
}
export function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
export function headerValue(value) {
    if (typeof value !== "string" || /[^\x20-\x7e\t]/.test(value))
        invalid("header values must be printable ASCII without line breaks");
    return value.trim().replace(/[ \t]+/g, " ");
}
export function signRequest(input) {
    const credentials = input.credentials;
    if (!credentials || typeof credentials.accessKeyId !== "string" || !/^[A-Za-z0-9_-]+$/.test(credentials.accessKeyId)
        || typeof credentials.secretAccessKey !== "string" || credentials.secretAccessKey.length === 0
        || credentials.secretAccessKey.length > 4096)
        invalid("explicit signing credentials are required");
    if (!/^[a-z0-9-]{1,64}$/.test(input.region))
        invalid("invalid signing region");
    if (!(input.date instanceof Date) || !Number.isFinite(input.date.getTime())
        || input.date.getUTCFullYear() < 1970 || input.date.getUTCFullYear() > 9999)
        invalid("invalid signing clock");
    const timestamp = input.date.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = timestamp.slice(0, 8);
    const headers = Object.create(null);
    for (const [name, value] of Object.entries(input.headers)) {
        const lower = name.toLowerCase();
        if (!/^[a-z0-9-]+$/.test(lower) || lower in headers)
            invalid("invalid or duplicate signing header");
        headers[lower] = headerValue(value);
    }
    if (!headers.host)
        invalid("host is required for signing");
    const payloadHash = sha256(input.body);
    headers["x-amz-date"] = timestamp;
    headers["x-amz-content-sha256"] = payloadHash;
    if (credentials.sessionToken !== undefined) {
        headers["x-amz-security-token"] = headerValue(credentials.sessionToken);
        if (!headers["x-amz-security-token"])
            invalid("session token must not be empty");
    }
    const names = Object.keys(headers).sort();
    const signedHeaders = names.join(";");
    const canonicalRequest = [input.method, input.path, input.query,
        names.map(name => `${name}:${headers[name]}\n`).join(""), signedHeaders, payloadHash].join("\n");
    const scope = `${date}/${input.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256(canonicalRequest)].join("\n");
    let key = createHmac("sha256", `AWS4${credentials.secretAccessKey}`).update(date).digest();
    for (const part of [input.region, "s3", "aws4_request"])
        key = createHmac("sha256", key).update(part).digest();
    const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    if (Object.entries(headers).reduce((size, [name, value]) => size + name.length + value.length + 4, 0) > 16 * 1024)
        invalid("request headers exceed 16 KiB");
    return { headers, canonicalRequest, signature };
}
//# sourceMappingURL=signature.js.map