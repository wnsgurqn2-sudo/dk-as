// Firebase Messaging Service Worker for DK AS
// 백그라운드 푸시 알림 처리 (앱이 꺼져있어도 동작)

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

// 백그라운드 메시지 수신 시 알림 표시
messaging.onBackgroundMessage((payload) => {
    const { title, body, type, url } = payload.data || {};

    const notificationOptions = {
        body: body || "",
        icon: "./icons/icon-72x72.png",
        badge: "./icons/icon-72x72.png",
        tag: type || "default",
        renotify: true,
        data: { url: url || "./index.html" }
    };

    self.registration.showNotification(title || "DK AS", notificationOptions);
});

// 알림 클릭 시 앱 열기
self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const url = event.notification.data?.url || "./index.html";

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes("dk-as") && "focus" in client) {
                    return client.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});
