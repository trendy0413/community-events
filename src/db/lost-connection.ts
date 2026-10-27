// Errors that mean the connection itself was lost (the server, a proxy or
// the network closed it), not that the SQL failed. Remote and serverless
// databases do this now and then, more under load and while waking up. A
// proxy that gives up on a slow login closes the connection before any SQL ran.
const LOST_CONNECTION_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '08000', '08003', '08006']);
const LOST_CONNECTION_MESSAGE = /connection terminated|not queryable|connection ended|authentication timed out/i;

export function isLostConnection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return (code !== undefined && LOST_CONNECTION_CODES.has(code)) || LOST_CONNECTION_MESSAGE.test(error.message);
}
