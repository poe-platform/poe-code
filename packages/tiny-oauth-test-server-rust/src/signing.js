import{createECDH,createHash,createPrivateKey,createPublicKey,generateKeyPairSync,sign}from'node:crypto';
function isObjectRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function createDeterministicEcPrivateKey(seed) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
        const digest = createHash("sha256")
            .update(seed)
            .update(":")
            .update(String(attempt))
            .digest();
        const ecdh = createECDH("prime256v1");
        try {
            ecdh.setPrivateKey(digest);
            const publicKey = ecdh.getPublicKey();
            return createPrivateKey({
                key: {
                    kty: "EC",
                    crv: "P-256",
                    d: digest.toString("base64url"),
                    x: publicKey.subarray(1, 33).toString("base64url"),
                    y: publicKey.subarray(33, 65).toString("base64url"),
                },
                format: "jwk",
            });
        }
        catch {
            continue;
        }
    }
    throw new Error("Unable to derive a deterministic ES256 key from the supplied seed");
}
function createSigningState(options) {
    const privateKey = resolvePrivateKey(options);
    const publicKey = createPublicKey(privateKey);
    const publicJwk = publicKey.export({ format: "jwk" });
    const alg = resolveSigningAlgorithm(privateKey);
    const kid = createHash("sha256")
        .update(JSON.stringify(sortJwkForThumbprint(publicJwk)))
        .digest("base64url");
    return {
        privateKey,
        publicJwk: {
            ...publicJwk,
            use: "sig",
            alg,
            kid,
        },
        alg,
        kid,
    };
}
function sortJwkForThumbprint(jwk) {
    return Object.fromEntries(Object.entries(jwk)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)));
}
function resolvePrivateKey(options) {
    if (options.signingKey !== undefined) {
        if (typeof options.signingKey === "string") {
            return createPrivateKey(options.signingKey);
        }
        if (isObjectRecord(options.signingKey)) {
            return createPrivateKey({
                key: options.signingKey,
                format: "jwk",
            });
        }
        throw new Error("signingKey must be a PEM string or a JWK object");
    }
    if (options.signingKeySeed !== undefined) {
        return createDeterministicEcPrivateKey(options.signingKeySeed);
    }
    return generateKeyPairSync("ec", {
        namedCurve: "P-256",
    }).privateKey;
}
function resolveSigningAlgorithm(privateKey) {
    if (privateKey.asymmetricKeyType === "rsa") {
        return "RS256";
    }
    if (privateKey.asymmetricKeyType === "ec") {
        const namedCurve = privateKey.asymmetricKeyDetails?.namedCurve;
        if (namedCurve !== undefined && namedCurve !== "prime256v1") {
            throw new Error("EC signingKey must use the P-256 curve for ES256");
        }
        return "ES256";
    }
    throw new Error("signingKey must be an RSA or P-256 EC private key");
}

export{createSigningState};
export function signJwt(state,header,payload){const input=Buffer.from(JSON.stringify(header)).toString("base64url")+"."+Buffer.from(JSON.stringify(payload)).toString("base64url");return new Promise((resolve,reject)=>{sign("sha256",Buffer.from(input),state.alg==="ES256"?{key:state.privateKey,dsaEncoding:"ieee-p1363"}:state.privateKey,(error,signature)=>{if(error)reject(error);else resolve(input+"."+signature.toString("base64url"));});});}

