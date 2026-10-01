'use strict';

const crypto = require('crypto');
const { JoyTreeClient, BASE_URL } = require('./joytree-client');
const { renderConnectPage } = require('./connect-page');

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * A minimal OAuth 2.1 authorization server for the JoyTree MCP server.
 *
 * JoyTree itself doesn't have an OAuth login flow -- only jtk_ API keys --
 * so "authorizing" here means: show a one-time form asking for your API
 * key, verify it's real against the live JoyTree API, then issue a normal
 * OAuth access/refresh token pair that maps back to that key. From then
 * on, Claude only ever sees an opaque OAuth token, never your raw API key.
 *
 * Everything is stored in memory. That means a server restart logs
 * everyone out (they just reconnect and paste their key again) -- an
 * acceptable tradeoff for v1, and easy to swap for Redis/a database later
 * without changing anything about how tools.js or the OAuth flow works.
 */
class JoyTreeOAuthProvider {
  constructor() {
    this.clients = new Map();       // client_id -> OAuthClientInformationFull
    this.pendingAuth = new Map();   // authorization code -> { apiKey, clientId, codeChallenge, redirectUri, resource }
    this.accessTokens = new Map();  // access token -> { apiKey, clientId, scopes, expiresAt }
    this.refreshTokens = new Map(); // refresh token -> { apiKey, clientId, scopes }

    this.clientsStore = {
      getClient: (clientId) => this.clients.get(clientId),
      registerClient: (client) => {
        const clientId = randomToken();
        const full = {
          ...client,
          client_id: clientId,
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        this.clients.set(clientId, full);
        return full;
      },
    };
  }

  // Step 1: render a plain HTML form asking for the JoyTree API key.
  // The OAuth params (client, state, PKCE challenge, redirect URI) travel
  // through as hidden fields so /authorize/submit has everything it needs
  // to finish the flow.
  async authorize(client, params, res) {
    const hidden = (name, value) =>
      `<input type="hidden" name="${name}" value="${value ? String(value).replace(/"/g, '&quot;') : ''}">`;

    const fields = [
      hidden('client_id', client.client_id),
      hidden('state', params.state),
      hidden('code_challenge', params.codeChallenge),
      hidden('redirect_uri', params.redirectUri),
      hidden('resource', params.resource ? params.resource.toString() : ''),
      hidden('scopes', (params.scopes || []).join(' ')),
    ].join('\n');

    res.status(200).set('Content-Type', 'text/html').send(renderConnectPage({ baseUrl: BASE_URL, fields }));
  }

  // Step 2 (mounted separately in server.js as a plain POST route): verify
  // the pasted key is real, mint an authorization code, redirect back to
  // Claude with it.
  async handleAuthorizeSubmit(req, res) {
    const { client_id, state, code_challenge, redirect_uri, resource, scopes, api_key } = req.body;

    if (!api_key || !api_key.startsWith('jtk_')) {
      res.status(400).send('A JoyTree API key starting with jtk_ is required. Go back and try again.');
      return;
    }

    try {
      await new JoyTreeClient(api_key).get('/api/auth/me');
    } catch (err) {
      res.status(401).send(`That API key didn't work (${err.message}). Go back and check it, or generate a fresh one from your JoyTree dashboard.`);
      return;
    }

    const code = randomToken();
    this.pendingAuth.set(code, {
      apiKey: api_key,
      clientId: client_id,
      codeChallenge: code_challenge,
      redirectUri: redirect_uri,
      resource: resource || undefined,
      scopes: scopes ? scopes.split(' ').filter(Boolean) : [],
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes to complete the exchange
    });

    const redirect = new URL(redirect_uri);
    redirect.searchParams.set('code', code);
    if (state) redirect.searchParams.set('state', state);
    res.redirect(redirect.toString());
  }

  async challengeForAuthorizationCode(_client, authorizationCode) {
    const entry = this.pendingAuth.get(authorizationCode);
    if (!entry || entry.expiresAt < Date.now()) throw new Error('Authorization code is invalid or expired');
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode) {
    const entry = this.pendingAuth.get(authorizationCode);
    if (!entry || entry.expiresAt < Date.now()) throw new Error('Authorization code is invalid or expired');
    this.pendingAuth.delete(authorizationCode); // one-time use

    const accessToken = randomToken();
    const refreshToken = randomToken();
    const expiresIn = 60 * 60 * 24 * 30; // 30 days -- there's no way to silently re-auth, so keep this long

    const tokenData = { apiKey: entry.apiKey, clientId: client.client_id, scopes: entry.scopes };
    this.accessTokens.set(accessToken, { ...tokenData, expiresAt: Date.now() + expiresIn * 1000 });
    this.refreshTokens.set(refreshToken, tokenData);

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: entry.scopes.join(' '),
    };
  }

  async exchangeRefreshToken(client, refreshToken) {
    const entry = this.refreshTokens.get(refreshToken);
    if (!entry) throw new Error('Refresh token is invalid');

    const accessToken = randomToken();
    const expiresIn = 60 * 60 * 24 * 30;
    this.accessTokens.set(accessToken, {
      apiKey: entry.apiKey,
      clientId: client.client_id,
      scopes: entry.scopes,
      expiresAt: Date.now() + expiresIn * 1000,
    });

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken, // reuse the same refresh token
      scope: entry.scopes.join(' '),
    };
  }

  async verifyAccessToken(token) {
    const entry = this.accessTokens.get(token);
    if (!entry) throw new Error('Access token is invalid');
    if (entry.expiresAt < Date.now()) {
      this.accessTokens.delete(token);
      throw new Error('Access token has expired');
    }
    return {
      token,
      clientId: entry.clientId,
      scopes: entry.scopes,
      expiresAt: Math.floor(entry.expiresAt / 1000),
      extra: { apiKey: entry.apiKey }, // this is how tools.js gets the real JoyTree key back out
    };
  }

  async revokeToken(_client, request) {
    this.accessTokens.delete(request.token);
    this.refreshTokens.delete(request.token);
  }
}

module.exports = { JoyTreeOAuthProvider };
