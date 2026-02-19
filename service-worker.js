// DK AS Service Worker (PWA 캐시 + FCM 푸시 알림)

// ===== Firebase Messaging =====
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
    apiKey: "AIzaSyAsLIn6sPehogVNwN2DAtjODo9ENuH7hQE",
    authDomain: "dk-as-b39cf.firebaseapp.com",
    projectId: "dk-as-b39cf",
    storageBucket: "dk-as-b39cf.firebasestorage.app",
    messagingSenderId: "124470106166",
    appId: "1:124470106166:web:e5f80a0ec7ffa0d93e2097"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const { title, body, type } = payload.data || {};
    self.registration.showNotification(title || "DK AS", {
        body: body || "",
        icon: "./icons/icon-72x72.png",
        badge: "./icons/icon-72x72.png",
        tag: type || "default",
        renotify: true,
        data: { url: "./index.html" }
    });
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes("dk-as") && "focus" in client) {
                    return client.focus();
                }
            }
            return clients.openWindow("./index.html");
        })
    );
});

// ===== PWA 캐시 =====
const CACHE_NAME = 'dk-as-v55';
const APP_VERSION = '55';
const urlsToCache = [
  './',
  './index.html',
  './styles.css?v=' + APP_VERSION,
  './app.js?v=' + APP_VERSION,
  './firebase-config.js?v=' + APP_VERSION,
  './manifest.json',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
];

// 설치 시 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('캐시 열림');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.log('캐시 실패:', error);
      })
  );
  self.skipWaiting();
});

// 활성화 시 이전 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('이전 캐시 삭제:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 요청 가로채기 - 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', (event) => {
  // GET 요청만 캐시 (POST 등은 캐시 불가)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Firebase/Google API 요청은 캐시하지 않음
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('firebaseio.com') || url.hostname.includes('firebasestorage.app')) {
    return;
  }

  // index.html, app.js, styles.css는 항상 네트워크에서 가져오기 (캐시 무시)
  if (url.pathname.endsWith('index.html') || url.pathname.endsWith('/') || url.pathname.endsWith('app.js') || url.pathname.endsWith('styles.css')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseClone);
            });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
