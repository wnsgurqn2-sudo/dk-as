// ==================== DK AS 알림 모듈 ====================
// FCM 토큰 관리, 알림 생성, 인앱 알림 표시

// VAPID KEY - Firebase Console에서 생성
// Firebase Console → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서 → 키 쌍 생성
const VAPID_KEY = "BAjgR4Rzc38DVLVErSXkrAQEDMaqGlixiCkhdnn-0VcpZFiqWUk7S4kbWXWXb1Vvtipz7aOWLqS3KGGsC3YgV3I";

let messagingInstance = null;

// ==================== FCM 초기화 ====================

async function initNotifications() {
    if (!VAPID_KEY || VAPID_KEY === "YOUR_VAPID_KEY_HERE") {
        console.warn("FCM VAPID key not configured. Push notifications disabled.");
        return;
    }

    if (!firebase.messaging.isSupported()) {
        console.warn("FCM not supported in this browser.");
        return;
    }

    try {
        messagingInstance = firebase.messaging();

        // 포그라운드 메시지 수신 (앱이 열려있을 때)
        messagingInstance.onMessage((payload) => {
            const title = payload.data?.title || payload.notification?.title;
            const body = payload.data?.body || payload.notification?.body;
            showInAppNotification(title, body);
        });

    } catch (error) {
        console.error("Notification init error:", error);
    }
}

// ==================== 알림 권한 요청 + FCM 토큰 ====================

async function requestNotificationPermission() {
    if (!messagingInstance) return;
    if (!currentUser) return;

    try {
        const permission = await Notification.requestPermission();

        if (permission === "granted") {
            const swReg = await navigator.serviceWorker.getRegistration();
            const token = await messagingInstance.getToken({
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: swReg
            });

            if (token) {
                await saveFcmToken(token);
                console.log("FCM token registered.");
            }
        } else {
            console.log("Notification permission denied.");
        }
    } catch (error) {
        console.error("FCM token error:", error);
    }
}

// Firestore에 FCM 토큰 저장
async function saveFcmToken(token) {
    if (!currentUser) return;

    try {
        const tokenId = hashToken(token);
        await db.collection("users").doc(currentUser.uid)
            .collection("fcmTokens").doc(tokenId).set({
                token: token,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                userAgent: navigator.userAgent
            });
    } catch (error) {
        console.error("Save FCM token error:", error);
    }
}

// 토큰 해시 (문서 ID용)
function hashToken(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return "t_" + Math.abs(hash).toString(36);
}

// ==================== 알림 생성 ====================
// Firestore notifications 컬렉션에 문서 생성 → Cloud Function이 FCM 전송

const _recentNotifications = new Map();
const NOTIFICATION_DEDUP_MS = 5000;

async function createNotification(type, productName, extraData) {
    if (!currentUser) return;
    if (!VAPID_KEY || VAPID_KEY === "YOUR_VAPID_KEY_HERE") return;

    // 중복 방지 (5초 이내 동일 알림)
    const dedupKey = `${type}:${productName || ""}`;
    const now = Date.now();
    const lastSent = _recentNotifications.get(dedupKey);
    if (lastSent && (now - lastSent) < NOTIFICATION_DEDUP_MS) {
        return;
    }
    _recentNotifications.set(dedupKey, now);

    if (_recentNotifications.size > 50) {
        for (const [key, time] of _recentNotifications) {
            if (now - time > NOTIFICATION_DEDUP_MS) _recentNotifications.delete(key);
        }
    }

    try {
        await db.collection("notifications").add({
            type: type,
            actorUid: currentUser.uid,
            productName: productName || "",
            extraData: extraData || {},
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            processed: false
        });
    } catch (error) {
        console.error("Create notification error:", error);
    }
}

// ==================== 인앱 알림 (포그라운드) ====================

function showInAppNotification(title, body) {
    const existing = document.getElementById("inAppNotification");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "inAppNotification";
    banner.className = "in-app-notification";
    banner.innerHTML = `
        <div class="in-app-notification-content">
            <strong>${esc(title || "알림")}</strong>
            <span>${esc(body || "")}</span>
        </div>
        <button onclick="this.parentElement.remove()">&times;</button>
    `;

    document.body.appendChild(banner);

    setTimeout(() => {
        if (banner.parentElement) {
            banner.classList.add("fade-out");
            setTimeout(() => banner.remove(), 300);
        }
    }, 5000);
}

// ==================== 알림 허용 버튼 ====================

function renderNotificationButton() {
    if (!VAPID_KEY || VAPID_KEY === "YOUR_VAPID_KEY_HERE") return;
    if (!("Notification" in window)) return;
    if (!firebase.messaging.isSupported()) return;
    if (document.getElementById("notifPermBtn")) return;

    const permission = Notification.permission;
    const settingsDropdown = document.getElementById("settingsDropdown");
    if (!settingsDropdown) return;

    if (permission === "default") {
        const notifItem = document.createElement("div");
        notifItem.className = "settings-item";
        notifItem.id = "notifPermItem";
        notifItem.style.marginTop = "8px";
        notifItem.innerHTML = `
            <span class="settings-label">푸시 알림</span>
            <button class="view-btn active" id="notifPermBtn"
                    style="background: linear-gradient(135deg, #FF9800, #F57C00); color: #fff;">
                알림 허용
            </button>
        `;

        // 로그아웃 버튼 앞에 삽입
        const logoutItem = settingsDropdown.querySelector(".settings-item:last-child");
        settingsDropdown.insertBefore(notifItem, logoutItem);

        document.getElementById("notifPermBtn").addEventListener("click", async () => {
            await requestNotificationPermission();
            if (Notification.permission === "granted") {
                document.getElementById("notifPermBtn").textContent = "허용됨";
                document.getElementById("notifPermBtn").disabled = true;
                document.getElementById("notifPermBtn").style.background = "#4CAF50";
                showToast("푸시 알림이 활성화되었습니다.", "success");
            }
        });
    } else if (permission === "granted") {
        // 이미 허용됨 → 토큰만 등록
        requestNotificationPermission();
    }
}
