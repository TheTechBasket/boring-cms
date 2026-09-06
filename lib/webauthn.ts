// Hand-rolled WebAuthn verification with node:crypto. ES256 and RS256 only;
// attestation statements are ignored (we authenticate, we do not attest).

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

export function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

export function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

// ---- Minimal CBOR decoder --------------------------------------------------
// Covers what authenticator payloads use: unsigned/negative ints, byte and
// text strings, arrays, maps. No floats, no tags, no indefinite lengths.

function cborDecode(buf: Buffer, offset = 0): [any, number] {
  const initial = buf[offset];
  const major = initial >> 5;
  const info = initial & 0x1f;
  let len = info;
  let pos = offset + 1;
  if (info === 24) { len = buf[pos]; pos += 1; }
  else if (info === 25) { len = buf.readUInt16BE(pos); pos += 2; }
  else if (info === 26) { len = buf.readUInt32BE(pos); pos += 4; }
  else if (info >= 27) throw new Error('CBOR: unsupported length');

  switch (major) {
    case 0: return [len, pos];
    case 1: return [-1 - len, pos];
    case 2: return [buf.subarray(pos, pos + len), pos + len];
    case 3: return [buf.subarray(pos, pos + len).toString('utf8'), pos + len];
    case 4: {
      const arr: any[] = [];
      for (let i = 0; i < len; i++) {
        const [v, next] = cborDecode(buf, pos);
        arr.push(v);
        pos = next;
      }
      return [arr, pos];
    }
    case 5: {
      const map = new Map();
      for (let i = 0; i < len; i++) {
        const [k, kNext] = cborDecode(buf, pos);
        const [v, vNext] = cborDecode(buf, kNext);
        map.set(k, v);
        pos = vNext;
      }
      return [map, pos];
    }
    default:
      throw new Error(`CBOR: unsupported major type ${major}`);
  }
}

// ---- Authenticator data ----------------------------------------------------

function parseAuthData(authData: Buffer) {
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const counter = authData.readUInt32BE(33);
  const out: any = { rpIdHash, flags, counter, userPresent: !!(flags & 0x01) };
  if (flags & 0x40) {
    // attested credential data
    const credIdLen = authData.readUInt16BE(53);
    out.credentialId = authData.subarray(55, 55 + credIdLen);
    const [coseKey] = cborDecode(authData, 55 + credIdLen);
    out.coseKey = coseKey;
  }
  return out;
}

// COSE key map to a JWK we can store as JSON and feed to createPublicKey.
function coseToJwk(cose: Map<number, any>) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7) {
    // ES256 on P-256
    return { kty: 'EC', crv: 'P-256', x: b64url(cose.get(-2)), y: b64url(cose.get(-3)) };
  }
  if (kty === 3 && alg === -257) {
    // RS256
    return { kty: 'RSA', n: b64url(cose.get(-1)), e: b64url(cose.get(-2)) };
  }
  throw new Error('Unsupported key type: only ES256 and RS256 are accepted.');
}

function checkClientData(clientDataJSON: Buffer, expectedType: string, challenge: string, origin: string) {
  const client = JSON.parse(clientDataJSON.toString('utf8'));
  if (client.type !== expectedType) throw new Error(`Unexpected clientData type: ${client.type}`);
  if (client.challenge !== challenge) throw new Error('Challenge mismatch.');
  if (client.origin !== origin) throw new Error(`Origin mismatch: ${client.origin}`);
}

function checkRpIdHash(rpIdHash: Buffer, rpId: string) {
  if (!rpIdHash.equals(createHash('sha256').update(rpId).digest())) throw new Error('rpId hash mismatch.');
}

// ---- Registration ----------------------------------------------------------
// Inputs are base64url strings straight from the browser credential.

export function verifyRegistration(
  { attestationObject, clientDataJSON }: { attestationObject: string; clientDataJSON: string },
  { challenge, origin, rpId }: { challenge: string; origin: string; rpId: string },
) {
  checkClientData(fromB64url(clientDataJSON), 'webauthn.create', challenge, origin);
  const [attMap] = cborDecode(fromB64url(attestationObject));
  const authData = parseAuthData(Buffer.from(attMap.get('authData')));
  checkRpIdHash(authData.rpIdHash, rpId);
  if (!authData.userPresent) throw new Error('User presence flag not set.');
  if (!authData.credentialId) throw new Error('No attested credential data.');
  return {
    credentialId: b64url(authData.credentialId),
    publicKeyJwk: coseToJwk(authData.coseKey),
    counter: authData.counter,
  };
}

// ---- Assertion (login) -----------------------------------------------------

export function verifyAssertion(
  { authenticatorData, clientDataJSON, signature }: { authenticatorData: string; clientDataJSON: string; signature: string },
  { publicKeyJwk, challenge, origin, rpId, counter }: { publicKeyJwk: any; challenge: string; origin: string; rpId: string; counter: number },
) {
  const clientData = fromB64url(clientDataJSON);
  checkClientData(clientData, 'webauthn.get', challenge, origin);
  const authData = fromB64url(authenticatorData);
  const parsed = parseAuthData(authData);
  checkRpIdHash(parsed.rpIdHash, rpId);
  if (!parsed.userPresent) throw new Error('User presence flag not set.');
  const key = createPublicKey({ key: publicKeyJwk, format: 'jwk' });
  const signed = Buffer.concat([authData, createHash('sha256').update(clientData).digest()]);
  const sigOpts = publicKeyJwk.kty === 'EC' ? { key, dsaEncoding: 'der' as const } : key;
  if (!cryptoVerify('sha256', signed, sigOpts as any, fromB64url(signature))) {
    throw new Error('Signature verification failed.');
  }
  // Counter check: authenticators that increment must move forward
  // (clone detection); zero means the authenticator does not count.
  if (parsed.counter !== 0 && parsed.counter <= counter) throw new Error('Counter did not increase.');
  return { counter: parsed.counter };
}
