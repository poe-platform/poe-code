export function getOwnErrorCode(error) {
    if (typeof error !== "object" ||
        error === null ||
        !Object.prototype.hasOwnProperty.call(error, "code")) {
        return undefined;
    }
    const code = error.code;
    return typeof code === "string" ? code : undefined;
}
export function hasOwnErrorCode(error, code) {
    return getOwnErrorCode(error) === code;
}
