// Minimal multipart/form-data parser for single-file admin uploads.
// ponytail: buffers the whole upload in memory (50 MB cap, single-admin CMS);
// switch to a streaming parser if concurrent large uploads ever matter.

export async function readMultipart(req, { limit = 50 * 1024 * 1024 } = {}) {
  const ct = req.headers['content-type'] || '';
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) throw new Error('Not a multipart request');
  const boundary = Buffer.from(`--${m[1] || m[2]}`);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Upload too large (50 MB max)');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  const fields: Record<string, string> = {};
  const files: Record<string, { filename: string; mime: string; data: Buffer }> = {};

  let start = body.indexOf(boundary);
  while (start !== -1) {
    start += boundary.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    start += 2; // CRLF after boundary
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const next = body.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const headers = body.subarray(start, headerEnd).toString('utf8');
    const content = body.subarray(headerEnd + 4, next - 2); // strip trailing CRLF

    const name = (headers.match(/name="([^"]*)"/) || [])[1];
    const filename = (headers.match(/filename="([^"]*)"/) || [])[1];
    const mime = ((headers.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream').trim();
    if (name !== undefined) {
      if (filename !== undefined) {
        if (filename) files[name] = { filename, mime, data: Buffer.from(content) };
      } else {
        fields[name] = content.toString('utf8');
      }
    }
    start = next;
  }
  return { fields, files };
}
