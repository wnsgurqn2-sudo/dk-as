// DK AS - Cloud Functions v1.0
// Firestore notifications 문서 생성 시 FCM 푸시 알림 전송

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

exports.processNotification = onDocumentCreated(
    "notifications/{notificationId}",
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const notification = snap.data();
        const { type, actorUid, productName, extraData } = notification;

        // 멱등성 보장: 중복 실행 방지
        const docRef = snap.ref;
        try {
            const alreadyProcessed = await db.runTransaction(async (transaction) => {
                const freshDoc = await transaction.get(docRef);
                if (!freshDoc.exists || freshDoc.data().processed === true) {
                    return true;
                }
                transaction.update(docRef, { processed: "processing" });
                return false;
            });

            if (alreadyProcessed) {
                console.log("Already processed, skipping:", event.params.notificationId);
                return;
            }
        } catch (txError) {
            console.error("Idempotency transaction error:", txError);
            return;
        }

        try {
            // 행동자 정보 조회
            const actorDoc = await db.collection("users").doc(actorUid).get();
            if (!actorDoc.exists) {
                await docRef.update({ processed: true, error: "actor not found" });
                return;
            }
            const actor = actorDoc.data();
            const actorRole = actor.role;
            const actorName = actor.name || actor.email;

            // 역할 기반 수신자 결정
            const recipientUids = new Set();

            if (actorRole === "user") {
                // 사용자 → 관리자 + 총책임자에게 알림
                const admins = await db.collection("users")
                    .where("approved", "==", true)
                    .where("role", "in", ["admin", "superadmin"])
                    .get();
                admins.forEach(doc => recipientUids.add(doc.id));
            } else if (actorRole === "admin") {
                // 관리자 → 총책임자에게만 알림
                const superAdmins = await db.collection("users")
                    .where("approved", "==", true)
                    .where("role", "==", "superadmin")
                    .get();
                superAdmins.forEach(doc => recipientUids.add(doc.id));
            }
            // 총책임자 행동 → 알림 없음

            // 본인 제외
            recipientUids.delete(actorUid);

            if (recipientUids.size === 0) {
                await docRef.update({ processed: true, recipientCount: 0 });
                return;
            }

            // 수신자별 알림 설정 확인 후 필터링
            const filteredUids = new Set();
            for (const uid of recipientUids) {
                const userDoc = await db.collection("users").doc(uid).get();
                if (!userDoc.exists) continue;
                const userData = userDoc.data();
                const settings = userData.notificationSettings;

                // 설정이 없으면 모든 알림 수신 (기본값: true)
                if (!settings) {
                    filteredUids.add(uid);
                    continue;
                }

                // 해당 알림 유형이 false가 아니면 수신
                if (settings[type] !== false) {
                    filteredUids.add(uid);
                }
            }

            if (filteredUids.size === 0) {
                await docRef.update({ processed: true, recipientCount: recipientUids.size, filteredOut: true });
                return;
            }

            // 알림 내용 생성
            const { title, body } = buildNotificationContent(type, actorName, productName, extraData || {});

            // FCM 토큰 수집
            const tokens = [];
            for (const uid of filteredUids) {
                const tokenSnap = await db.collection("users").doc(uid)
                    .collection("fcmTokens").get();
                tokenSnap.forEach(doc => {
                    const tokenData = doc.data();
                    if (tokenData.token) {
                        tokens.push({ token: tokenData.token, ref: doc.ref });
                    }
                });
            }

            if (tokens.length === 0) {
                await docRef.update({ processed: true, recipientCount: filteredUids.size, tokenCount: 0 });
                return;
            }

            // FCM 데이터 메시지 전송
            const messaging = getMessaging();
            const sendResults = await Promise.allSettled(
                tokens.map(({ token, ref }) =>
                    messaging.send({
                        token: token,
                        data: { title, body, type, url: "/dk-as/index.html" }
                    }).catch(async (error) => {
                        // 만료/무효 토큰 자동 삭제
                        if (
                            error.code === "messaging/invalid-registration-token" ||
                            error.code === "messaging/registration-token-not-registered"
                        ) {
                            await ref.delete();
                        }
                        throw error;
                    })
                )
            );

            const successCount = sendResults.filter(r => r.status === "fulfilled").length;

            await docRef.update({
                processed: true,
                recipientCount: filteredUids.size,
                tokenCount: tokens.length,
                successCount
            });

        } catch (error) {
            console.error("processNotification error:", error);
            await docRef.update({ processed: true, error: error.message });
        }
    }
);

// DK AS 이벤트별 알림 내용 생성
function buildNotificationContent(type, actorName, productName, extraData) {
    const name = productName || "제품";

    switch (type) {
        case "rental":
            return {
                title: "임대 알림",
                body: `${actorName}님이 "${name}"을(를) ${extraData.company || ""}에 임대했습니다.`
            };
        case "return":
            return {
                title: "임대회수 알림",
                body: `${actorName}님이 "${name}"을(를) 회수했습니다. (${extraData.status || ""})`
            };
        case "status_change":
            return {
                title: "상태변경 알림",
                body: `${actorName}님이 "${name}" 상태를 ${extraData.newStatus || ""}(으)로 변경했습니다.`
            };
        case "outsource_request":
            return {
                title: "외주요청 알림",
                body: `${actorName}님이 "${name}" 수리를 외주요청했습니다.`
            };
        case "product_registered":
            return {
                title: "제품등록 알림",
                body: `${actorName}님이 "${name}"을(를) 등록했습니다.`
            };
        case "product_deleted":
            return {
                title: "제품삭제 알림",
                body: `${actorName}님이 "${name}"을(를) 삭제했습니다.`
            };
        default:
            return {
                title: "DK AS 알림",
                body: `${actorName}님의 새로운 활동이 있습니다.`
            };
    }
}
