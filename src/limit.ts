// limit.ts
// Workers Rate Limiting helper shared by the chat endpoints and the panel login.

// True when this client exceeded the limiter. A missing binding or a limiter
// error never blocks anybody.
export async function isRateLimited(limiter: RateLimit | undefined, request: Request): Promise<boolean> {
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
    return !success;
  } catch (e) {
    console.error('rate limiter failed:', (e as Error)?.message);
    return false;
  }
}

// Atomic fixed-window counter in D1: one UPSERT ... RETURNING statement, so
// parallel requests each get a distinct count. Returns the count including this
// call; the caller compares it with its cap. A window that started more than
// `windowMs` ago restarts at 1.
export async function hit(db: D1Database, bucket: string, windowMs: number, now = Date.now()): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO panel_throttle (bucket, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET
         count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
       RETURNING count`,
    )
    .bind(bucket, now, now - windowMs)
    .first<{ count: number }>();
  return row?.count ?? Number.MAX_SAFE_INTEGER; // no row back: fail closed
}
