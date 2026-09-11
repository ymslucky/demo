/**
 * WebCrypto JWT signing helpers shared by the auth test suites.
 *
 * Extracted verbatim from tests/code-run.test.ts so multiple suites can
 * mint locally-signed ES256/RS256 tokens. Node's WebCrypto signs both
 * algorithms natively (RSA-OAEP is not needed: RSASSA-PKCS1-v1_5 keys
 * support subtle.sign directly); no jose dependency, no network.
 */

const encoder = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlJson(value: unknown): string {
  return b64urlEncode(encoder.encode(JSON.stringify(value)));
}

export async function generateSigningKey(alg: "ES256" | "RS256", kid = "test-key") {
  const pair = (await crypto.subtle.generateKey(
    alg === "ES256"
      ? { name: "ECDSA", namedCurve: "P-256" }
      : {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid,
  };
  return { privateKey: pair.privateKey, jwk };
}

export async function signJwt(
  alg: "ES256" | "RS256",
  keys: { privateKey: CryptoKey },
  payload: Record<string, unknown>,
  kid = "test-key",
): Promise<string> {
  const header = { alg, kid, typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" },
    keys.privateKey,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${b64urlEncode(new Uint8Array(signature))}`;
}

/** Convenience wrapper: an ES256 keypair plus its kid-tagged public JWK. */
export function generateEs256Keys(kid = "test-key") {
  return generateSigningKey("ES256", kid);
}

/** Convenience wrapper: an RS256 keypair plus its kid-tagged public JWK. */
export function generateRs256JwkAndSign(kid = "test-key") {
  return generateSigningKey("RS256", kid);
}
