// Shared helper for every game page that loads a `?activity=<shareId>` link from the public
// sharedActivities collection. Classifies a failed getDoc() so pages can tell a genuine
// connectivity problem apart from a link that is gone (never existed, was deleted/revoked by its
// owner, or has expired — firestore.rules denies the read the same way for all three, by design,
// so this module cannot and does not try to tell those apart from each other).
const NETWORK_ERROR_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'internal',
  'cancelled',
  'unknown',
  'resource-exhausted'
]);

export function isNetworkErrorCode(err) {
  return Boolean(err && NETWORK_ERROR_CODES.has(err.code));
}
