export function createS3Transport(client, capabilities = {}) {
    const transport = {
        capabilities: Object.freeze({ ...capabilities }),
        ...(client.getObjectStream ? { getObjectStream: (input, options) => client.getObjectStream(input, options) } : {}),
        ...(client.putObjectStream ? { putObjectStream: (input, options) => client.putObjectStream(input, options) } : {}),
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
    code;
    $metadata;
    constructor(code, status, message = code) {
        super(message);
        this.name = code;
        this.code = code;
        this.$metadata = { httpStatusCode: status };
    }
}
export function encodeCopySource(bucket, key) {
    return [bucket, ...key.split("/")].map((part) => encodeURIComponent(part)
        .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}
//# sourceMappingURL=transport.js.map