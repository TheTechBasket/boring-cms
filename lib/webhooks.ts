import { createHmac } from 'node:crypto';

export type WebhookEvent = 'entry.publish' | 'entry.unpublish' | 'entry.delete';

export interface WebhookPayload {
  event: WebhookEvent;
  project: string;
  collection: string;
  slug: string;
  at?: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

// fire-and-forget, never throws, never awaited by callers
export function fireWebhook(
  url: string,
  secret: string | null | undefined,
  payload: WebhookPayload,
): void {
  (async () => {
    const fullPayload = {
      event: payload.event,
      project: payload.project,
      collection: payload.collection,
      slug: payload.slug,
      at: payload.at || new Date().toISOString(),
    };
    const body = JSON.stringify(fullPayload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'boring-cms-webhook',
    };
    if (secret) {
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      headers['X-Boring-Signature'] = `sha256=${sig}`;
    }

    // ponytail: in-process retries only, delivery log table if reliability ever matters.
    const retryDelays = [5000, 30000];
    let lastError = '';

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      if (attempt > 0) {
        await wait(retryDelays[attempt - 1]);
      }
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          return;
        }
        lastError = `HTTP ${res.status}`;
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }

    console.error(`webhook delivery failed: url=${url} event=${payload.event} error=${lastError}`);
  })().catch(() => {
    // never throws
  });
}
