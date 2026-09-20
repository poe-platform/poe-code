import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const reference = await tsImport("../../mcp-oauth/src/client/token-endpoint.ts", import.meta.url);
function input(payload, now = () => 1000) { return { tokenEndpoint:"https://auth.example/token", clientId:"client", code:"code", codeVerifier:"verifier", redirectUri:"http://localhost/callback", refreshToken:"refresh", resource:"https://RESOURCE.example:443/a#fragment", now, fetch:async () => new Response(JSON.stringify(payload)) }; }
async function compare(payload, now) {
  const { exchangeAuthorizationCode } = await import("../dist/tokens.js");
  const outcome = async factory => { try { return { value:await factory(input(payload,now)) }; } catch(error) { return { error:error.message, name:error.name, code:error.code }; } };
  assert.deepEqual(await outcome(exchangeAuthorizationCode), await outcome(reference.exchangeAuthorizationCode));
}
test("token parsing matches access/type/expiry/optional-field rules and Date boundaries", async () => {
  for (const payload of [{}, {access_token:" ",token_type:"Bearer"}, {access_token:" t\ud800 ",token_type:"bEaReR"}, {access_token:"t",token_type:"Bearer ",expires_in:0}, {access_token:"t",token_type:"Bearer",expires_in:null}, {access_token:"t",token_type:"Bearer",expires_in:0.5}, {access_token:"t",token_type:"Bearer",expires_in:-1}, {access_token:"t",token_type:"Bearer",expires_in:2,refresh_token:" refresh ",scope:" scope "}, {access_token:"t",token_type:"Bearer",refresh_token:123,scope:" "}]) await compare(payload);
  for (const now of [0,0.5,NaN,Infinity,8_640_000_000_000_000,8_640_000_000_000_001,-8_640_000_000_000_000,-8_640_000_000_000_001]) await compare({access_token:"t",token_type:"Bearer",expires_in:0}, () => now);
  for (const char of ["\u0085","\ufeff","\u200b","\u2000","\u2028","\u3000"]) await compare({ access_token:char+"t"+char, token_type:"Bearer", refresh_token:char+"r"+char, scope:char+"s"+char });
});
test("code exchange and refresh build matching form bodies and consult clocks only when needed", async () => {
  const own = await import("../dist/tokens.js");
  for (const method of ["exchangeAuthorizationCode","refreshAccessToken"]) for (const secret of [undefined,"secret +~🦊\ud800"]) {
    let expected;
    for (const factory of [reference,own]) {
      let observed; let clocks=0;
      const args = { ...input({ access_token:"t",token_type:"Bearer" }), clientSecret:secret, code:"code +~🦊\ud800", now() { clocks++; throw new Error("must not call"); }, fetch:async(url,init) => { observed = {url,method:init.method,headers:init.headers,body:init.body,redirect:init.redirect,signal:!!init.signal}; return new Response('{"access_token":"t","token_type":"Bearer"}'); } };
      const result = await factory[method](args); assert.equal(result.expiresAt,null); assert.equal(clocks,0);
      if (factory===reference) expected=observed; else assert.deepEqual(observed,expected);
    }
  }
});
test("OAuth JSON body failures and protocol errors preserve aliases and retry classification", async () => {
  const own = await import("../dist/tokens.js");
  for (const status of [200,400,503,500]) for (const body of ["not json","[]","{}",'{"error":"invalid_grant","error_description":"bad\\ud800","error_uri":"uri"}','{"error":"","error_description":""}']) {
    const outcome = async factory => { try { return {value:await factory.readOAuthJsonObjectResponse(new Response(body,{status}))}; } catch(error) { return Object.fromEntries(["name","message","error","errorDescription","errorUri","error_description","error_uri","status","retryable","terminal"].map(key=>[key,error[key]])); } };
    assert.deepEqual(await outcome(own),await outcome(reference));
  }
  for (const status of [400,500,503]) for (const error of ["invalid_grant","server_error","temporarily_unavailable",""]) {
    const a = new native.OAuthError({error,error_description:"bad\ud800",error_uri:"uri"},status);
    const b = new reference.OAuthError({error,error_description:"bad\ud800",error_uri:"uri"},status);
    for (const key of ["message","error","errorDescription","errorUri","status","retryable","terminal"]) assert.equal(a[key],b[key]);
  }
});
test("bounded OAuth readers preserve size errors, abort reasons and malformed UTF-8 fallbacks", async () => {
  const own = await import("../dist/tokens.js");
  for (const factory of [reference, own]) {
    for (const status of [200, 400, 503]) {
      await assert.rejects(factory.readOAuthJsonObjectResponse(new Response("{}", { status, headers: { "Content-Length": String(1024 * 1024 + 1) } })), /HTTP response exceeds/);
      await assert.rejects(factory.readOAuthJsonObjectResponse(new Response(" ".repeat(1024 * 1024 + 1), { status })), /HTTP response exceeds/);
      const controller = new AbortController();
      const reason = new Error("aborted request"); controller.abort(reason);
      await assert.rejects(factory.readOAuthJsonObjectResponse(new Response("{}", { status }), controller.signal), error => error === reason);
      const expected = status === 200 ? "OAuth response must be a JSON object" : status === 503 ? "temporarily_unavailable" : "server_error";
      await assert.rejects(factory.readOAuthJsonObjectResponse(new Response(Uint8Array.of(255), { status })), error => error.message === expected);
    }
  }
});
test("seeded Unicode token values and expiry arithmetic match the independent oracle", async () => {
  let seed = 0x913eb74;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let index = 0; index < 512; index++) {
    const text = String.fromCharCode(...Array.from({ length: random() % 24 }, () => random() & 65535));
    await compare({ access_token: text, token_type: "Bearer", refresh_token: text, scope: text });
    const seconds = random() * (index % 3 ? 1 : 1e8);
    const now = index % 2 ? random() : -8_640_000_000_000_000 + random();
    await compare({ access_token: "t", token_type: "Bearer", expires_in: seconds }, () => now);
  }
});
test("inherited token, native envelope and OAuth error fields cannot contaminate results", async () => {
  const own = await import("../dist/tokens.js");
  const pollution = { access_token:"polluted",token_type:"Bearer",expires_in:-1,refresh_token:"polluted",scope:"polluted",refreshToken:"polluted",error:"invalid_grant",error_description:"polluted",error_uri:"polluted" };
  const originals = new Map(Object.keys(pollution).map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype,key)]));
  try {
    for (const [key,value] of Object.entries(pollution)) Object.defineProperty(Object.prototype,key,{value,writable:true,configurable:true});
    await compare({});
    await compare({access_token:"t",token_type:"Bearer"});
    const error = await own.readOAuthJsonObjectResponse(new Response("{}", {status:400})).catch(error=>error);
    assert.equal(error.error,"server_error"); assert.equal(error.errorDescription,undefined); assert.equal(error.errorUri,undefined);
  } finally {
    for (const [key,descriptor] of originals) { if (descriptor) Object.defineProperty(Object.prototype,key,descriptor); else delete Object.prototype[key]; }
  }
});
