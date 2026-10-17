// Senzu Home PWA Service Worker - Production Ready
const CACHE_VERSION = 'senzu-home-v2';
const STATIC_CACHE_NAME = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE_NAME = `${CACHE_VERSION}-runtime`;

// Essential App Shell & Brand Assets
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/assets/brand/senzu-app-icon.svg',
  '/assets/brand/senzu-app-icon-192.png',
  '/assets/brand/senzu-app-icon-512.png',
  '/assets/brand/apple-touch-icon.png',
  '/assets/brand/favicon-32x32.png',
  '/assets/brand/senzu-logo-dark.svg',
  '/assets/brand/senzu-logo-light.svg',
];

// Domains, paths, and patterns that MUST NEVER be cached (Prompt 19A Part 4)
function isDynamicOrSensitiveRequest(url) {
  const pathname = url.pathname.toLowerCase();
  const host = url.hostname.toLowerCase();

  // Never cache Digital Asset Links, .well-known, or TWA verification files
  if (
    pathname.startsWith('/.well-known/') ||
    pathname.includes('assetlinks.json')
  ) {
    return true;
  }

  // Never cache API requests, operational endpoints, or status endpoints
  if (
    pathname.startsWith('/api/') ||
    pathname.includes('/staff') ||
    pathname.includes('/booking') ||
    pathname.includes('/therapist') ||
    pathname.includes('/customer') ||
    pathname.includes('/payment') ||
    pathname.includes('/tracking') ||
    pathname.includes('/gps') ||
    pathname.includes('/order') ||
    pathname.includes('/roster') ||
    pathname.includes('/auth') ||
    pathname.includes('/reconcile') ||
    pathname.includes('/audit')
  ) {
    return true;
  }

  // Never cache Firebase Firestore, Auth, Storage, Google Identity, Google Cloud
  if (
    host.includes('firestore') ||
    host.includes('googleapis.com') ||
    host.includes('identitytoolkit') ||
    host.includes('securetoken') ||
    host.includes('firebase') ||
    host.includes('firebasestorage') ||
    host.includes('cloudfunctions.net') ||
    host.includes('cloudresourcemanager')
  ) {
    return true;
  }

  // Never cache live Google Maps Tiles or Dynamic Geocoding
  if (host.includes('maps.googleapis.com') || host.includes('maps.gstatic.com')) {
    return true;
  }

  // Never cache query strings that indicate dynamic/operational state
  if (url.search && (url.search.includes('token') || url.search.includes('code') || url.search.includes('ts='))) {
    return true;
  }

  return false;
}

// Install Event - Precache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then(async (cache) => {
      try {
        await cache.addAll(PRECACHE_ASSETS);
      } catch (err) {
        console.warn('[SW] Precache partial error (non-fatal):', err);
      }
    })
    // Prompt 19A Part 5: Do NOT call self.skipWaiting() here automatically.
    // Controlled update prompt in UI will trigger message { type: 'SKIP_WAITING' }.
  );
});

// Controlled Skip-Waiting Message Listener (Prompt 19A Part 5)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate Event - Clean up stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (!name.startsWith(CACHE_VERSION)) {
            console.log('[SW] Purging outdated cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Safe strategy
self.addEventListener('fetch', (event) => {
  // Only handle HTTP/HTTPS GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. Bypass dynamic, operational, or sensitive requests
  if (isDynamicOrSensitiveRequest(url)) {
    return;
  }

  // 2. Google Fonts: Cache First with Stale-While-Revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(STATIC_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // 3. Navigation Requests (HTML Page Load): Network First with Offline App Shell Fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // If network succeeds, update app shell cache in background
          if (networkResponse.status === 200) {
            const resClone = networkResponse.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => {
              cache.put('/index.html', resClone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Offline fallback: Return cached index.html
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) return cachedIndex;
          return new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Senzu Home Offline</title></head><body style="font-family:sans-serif;text-align:center;padding:40px;"><h2>Koneksi Internet Terputus</h2><p>Aplikasi Senzu Home memerlukan koneksi internet untuk memuat data terkini. Silakan periksa jaringan Anda dan coba lagi.</p><button onclick="window.location.reload()">Muat Ulang</button></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // 4. Static Assets (JS, CSS, SVGs, PNGs, Fonts): Stale While Revalidate
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.ico');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const resClone = networkResponse.clone();
              caches.open(RUNTIME_CACHE_NAME).then((cache) => {
                cache.put(event.request, resClone);
              });
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 5. Default network fallback: purely fetch from network without serving stale cache
  event.respondWith(fetch(event.request));
});

// Push Notification Handler for Senzu Home PWA
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { message: event.data.text() };
    }
  }

  const isChat = data.type === 'CHAT_MESSAGE' || data.notificationType === 'chat';
  const title = data.title || (isChat ? 'Senzu Home' : 'Senzu Home Reflexology');
  const body = data.body || data.message || (isChat ? 'Pesan baru pada pesanan Anda.' : 'Pembaruan status pemesanan Senzu Home Anda.');
  const targetUrl = data.actionUrl || data.url || (data.bookingId ? `/?openChat=${encodeURIComponent(data.bookingId)}` : '/');
  const tag = isChat ? `chat-${data.bookingId || 'general'}` : (data.bookingCode || 'senzu-update');

  const options = {
    body,
    icon: '/assets/brand/senzu-app-icon-192.png',
    badge: '/assets/brand/senzu-app-icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: targetUrl,
      bookingId: data.bookingId || null,
      messageId: data.messageId || null,
      notificationId: data.id || null,
      isChat,
    },
    tag,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification Click Handler - Focus or Open Window and navigate to chat
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (notifData.bookingId) {
            client.postMessage({
              type: 'OPEN_BOOKING_CHAT',
              bookingId: notifData.bookingId,
            });
          }
          if ('navigate' in client && client.url !== targetUrl) {
            return client.navigate(targetUrl);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
