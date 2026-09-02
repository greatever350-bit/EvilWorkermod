// worker_8t2r.js – Stealth Service Worker (No JSON envelope)
self.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // Build relay URL with the target as a query param
  const relayUrl = `/api/gateway?target=${encodeURIComponent(request.url)}`;
  try {
    // Forward the request exactly as-is, with original method, headers, body
    return fetch(relayUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',      // We control redirects server-side
      mode: 'same-origin'
    });
  } catch (e) {
    return new Response('Network error', { status: 502 });
  }
}
