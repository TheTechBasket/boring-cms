// Media storage backends. Interface:
//   put(key, buffer, mime) -> Promise<void>
//   stream(key) -> Readable | Promise<Readable> | null (null = not found)
//   remove(key) -> Promise<void> (missing keys are not an error)
//   publicUrl(key) -> string | null (null = serve through the app)
// Keys are generated server-side as <hash8>-<slug>.<ext>, one path segment.

import { mkdirSync, createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

export function localBackend(dir) {
  mkdirSync(dir, { recursive: true });
  return {
    async put(key, buf) {
      await writeFile(path.join(dir, key), buf);
    },
    stream(key) {
      const p = path.join(dir, key);
      return existsSync(p) ? createReadStream(p) : null;
    },
    // Cheap existence check for migrate: no stream opened, no bytes read.
    exists(key) {
      return existsSync(path.join(dir, key));
    },
    async remove(key) {
      try {
        await unlink(path.join(dir, key));
      } catch {
        // already gone
      }
    },
    publicUrl() {
      return null;
    },
    presignPut() {
      return null; // local uploads go through the app
    },
    async list() {
      return readdirSync(dir).map((f) => ({ key: f, size: statSync(path.join(dir, f)).size }));
    },
  };
}

// Hand-rolled AWS SigV4 over fetch. Works with S3, R2 and MinIO
// (path-style addressing: <endpoint>/<bucket>/<key>).

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

function sha256hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function s3Backend({ endpoint, bucket, region = 'auto', accessKey, secretKey, publicUrl = null }) {
  const base = endpoint.replace(/\/+$/, '');

  async function request(method, key, body = null, extraHeaders = {}) {
    const url = new URL(`${base}/${bucket}/${key}`);
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256hex(body || '');

    const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extraHeaders };
    const sorted = Object.entries(headers)
      .map(([k, v]) => [k.toLowerCase(), String(v).trim()])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const signedHeaders = sorted.map(([k]) => k).join(';');
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      sorted.map(([k, v]) => `${k}:${v}\n`).join(''),
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
    let k = hmac(`AWS4${secretKey}`, dateStamp);
    for (const part of [region, 's3', 'aws4_request']) k = hmac(k, part);
    const signature = hmac(k, stringToSign).toString('hex');

    return fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: body || undefined,
    });
  }

  return {
    async put(key, buf, mime) {
      const res = await request('PUT', key, buf, { 'content-type': mime });
      if (!res.ok) throw new Error(`S3 PUT ${key} failed: ${res.status} ${await res.text()}`);
    },
    async stream(key) {
      const res = await request('GET', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 GET ${key} failed: ${res.status}`);
      return Readable.fromWeb(res.body as any);
    },
    // HEAD, not GET: existence only, no object body pulled over the wire.
    async exists(key) {
      const res = await request('HEAD', key);
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`S3 HEAD ${key} failed: ${res.status}`);
      return true;
    },
    async remove(key) {
      await request('DELETE', key);
    },
    publicUrl(key) {
      return publicUrl ? `${publicUrl.replace(/\/+$/, '')}/${key}` : null;
    },
    // Presigned PUT (query-string auth) so the browser uploads straight to
    // the bucket; the server never proxies the bytes. Needs a CORS rule on
    // the bucket allowing PUT from the admin origin.
    presignPut(key, mime, expires = 900) {
      const url = new URL(`${base}/${bucket}/${key}`);
      const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);
      const scope = `${dateStamp}/${region}/s3/aws4_request`;
      const params = new URLSearchParams({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${accessKey}/${scope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(expires),
        'X-Amz-SignedHeaders': 'host',
      });
      const canonicalQuery = [...params.entries()]
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .sort()
        .join('&');
      const canonicalRequest = ['PUT', url.pathname, canonicalQuery, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
      let k = hmac(`AWS4${secretKey}`, dateStamp);
      for (const part of [region, 's3', 'aws4_request']) k = hmac(k, part);
      params.set('X-Amz-Signature', hmac(k, stringToSign).toString('hex'));
      return `${url.origin}${url.pathname}?${params.toString()}`;
    },
    // ListObjectsV2, XML picked apart with regex (keys are our own slugs,
    // no entities to worry about).
    async list() {
      const keys: Array<{ key: string; size: number }> = [];
      let token = '';
      do {
        const query = `list-type=2${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
        const url = new URL(`${base}/${bucket}/?${query}`);
        const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
        const dateStamp = amzDate.slice(0, 8);
        const payloadHash = sha256hex('');
        const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
        const sorted = Object.entries(headers).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const signedHeaders = sorted.map(([k]) => k).join(';');
        const canonicalQuery = url.search
          .slice(1)
          .split('&')
          .map((p) => (p.includes('=') ? p : `${p}=`))
          .sort()
          .join('&');
        const canonicalRequest = ['GET', url.pathname, canonicalQuery, sorted.map(([k, v]) => `${k}:${v}\n`).join(''), signedHeaders, payloadHash].join('\n');
        const scope = `${dateStamp}/${region}/s3/aws4_request`;
        const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
        let k = hmac(`AWS4${secretKey}`, dateStamp);
        for (const part of [region, 's3', 'aws4_request']) k = hmac(k, part);
        const signature = hmac(k, stringToSign).toString('hex');
        const res = await fetch(url, {
          headers: { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
        });
        if (!res.ok) throw new Error(`S3 LIST failed: ${res.status} ${await res.text()}`);
        const xml = await res.text();
        for (const m of xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g)) {
          keys.push({ key: m[1], size: Number(m[2]) });
        }
        token = (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1] || '';
      } while (token);
      return keys;
    },
  };
}
