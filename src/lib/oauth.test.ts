import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSupportedScopes,
  OAuthError,
  OAUTH_SCOPE,
  parseScopes,
  redirectUriIsAllowed,
  redirectUriMatches,
  sha256,
  verifyPkce,
} from './oauth';

test('parseScopes defaults to the OurTrips write scope and dedupes scopes', () => {
  assert.deepEqual(parseScopes(undefined), [OAUTH_SCOPE]);
  assert.deepEqual(parseScopes(` ${OAUTH_SCOPE} ${OAUTH_SCOPE} `), [OAUTH_SCOPE]);
});

test('assertSupportedScopes rejects unknown OAuth scopes', () => {
  assert.throws(
    () => assertSupportedScopes([OAUTH_SCOPE, 'trips:delete']),
    (err) => err instanceof OAuthError && err.code === 'invalid_scope'
  );
});

test('redirectUriMatches allows loopback callback ports to vary', () => {
  assert.equal(
    redirectUriMatches('http://localhost:61234/callback', 'http://localhost:3000/callback'),
    true
  );
  assert.equal(
    redirectUriMatches('http://localhost:61234/other', 'http://localhost:3000/callback'),
    false
  );
});

test('redirectUriIsAllowed rejects unsafe callback schemes', () => {
  assert.equal(redirectUriIsAllowed('https://claude.ai/api/mcp/auth_callback'), true);
  assert.equal(redirectUriIsAllowed('http://localhost:14567/oauth/callback'), true);
  assert.equal(redirectUriIsAllowed('http://example.com/oauth/callback'), false);
  assert.equal(redirectUriIsAllowed('javascript:alert(1)'), false);
});

test('verifyPkce checks an S256 challenge', () => {
  const verifier = 'test-code-verifier';
  assert.equal(verifyPkce(verifier, sha256(verifier)), true);
  assert.equal(verifyPkce('wrong-verifier', sha256(verifier)), false);
});
