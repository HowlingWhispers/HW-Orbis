import type { Request, Response, NextFunction } from 'express';

/**
 * Terminal handler for API paths that matched no router.
 *
 * Without this, an unmatched `/api/...` request falls through to the single-page
 * app catch-all and receives `index.html` with a 200. A client that calls an
 * endpoint the running server does not have — a stale browser tab, a base URL
 * pointing at the wrong origin, or a frontend deployed ahead of its backend —
 * then fails deep inside `response.json()` with an opaque parse error instead of
 * a reportable 404. The mismatch is what made a missing route look like a broken
 * administration console.
 *
 * Mounted ahead of the SPA fallback so API callers always get JSON.
 */
export function apiNotFound(_request: Request, response: Response, _next: NextFunction) {
  response.status(404).json({
    error: 'That Orbis API endpoint does not exist. The page may be out of date — reload to get the current application.',
  });
}
