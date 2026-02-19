// DK AS - Cloud Functions v1.1
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
        console.log("=== processNotification 시작 ===", event.params.notificationId);

        const snap = event.data;
        if (!snap) {
            console.error("event.data가 null입니다.");
            return;
        }

        const notification = snap.data();
        console.log("알림 데이터:", JSON.stringify(notification));

        const { type, actorUid, productName, extraData } = notification;

        if (!actorUid) {
            console.error("actorUid가 없습니다.");
            return;
        }

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
                console.log("이미 처리됨, 건너뜀:", event.params.notificationId);
                return;
            }
        } catch (txError) {
            console.error("멱등성 트랜잭션 에러:", txError);
            return;
        }

        console.log("멱등성 확인 통과");

        try {
            // 행동자 정보 조회
            const actorDoc = await db.collection("users").doc(actorUid).get();
            if (!actorDoc.exists) {
                console.error("행동자 문서 없음:", actorUid);
                await docRef.update({ processed: true, error: "actor not found" });
                return;
            }
            const actor = actorDoc.data();
            const actorRole = actor.role || "user"; // role 필드 없으면 기본값 user
            const actorName = actor.name || actor.email;
            console.log(`행동자: ${actorName}, 역할: ${actorRole}`);

            // 역할 기반 수신자 결정
            const recipientUids = new Set();

            if (actorRole === "user") {
                console.log("사용자 행동 → 관리자 + 총책임자에게 알림");
                const admins = await db.collection("users")
                    .where("approved", "==", true)
                    .where("role", "in", ["admin", "superadmin"])
                    .get();
                console.log(`관리자/총책임자 조회 결과: ${admins.size}명`);
                admins.forEach(doc => {
                    console.log(`  수신자 후보: ${doc.id} (${doc.data().name}, ${doc.data().role})`);
                    recipientUids.add(doc.id);
                });
            } else if (actorRole === "admin") {
                console.log("관리자 행동 → 총책임자에게만 알림");
                const superAdmins = await db.collection("users")
                    .where("approved", "==", true)
                    .where("role", "==", "superadmin")
                    .get();
                console.log(`총책임자 조회 결과: ${superAdmins.size}명`);
                superAdmins.forEach(doc => {
                    console.log(`  수신자 후보: ${doc.id} (${doc.data().name}, ${doc.data().role})`);
                    recipientUids.add(doc.id);
                });
            } else {
                console.log(`총책임자(${actorRole}) 행동 → 알림 없음`);
            }

            // 본인 제외
            recipientUids.delete(actorUid);
            console.log(`본인 제외 후 수신자: ${recipientUids.size}명`);

            if (recipientUids.size === 0) {
                console.log("수신자 없음, 종료");
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

                if (!settings) {
                    filteredUids.add(uid);
                    continue;
                }

                if (settings[type] !== false) {
                    filteredUids.add(uid);
                } else {
                    console.log(`  ${uid}: ${type} 알림 비활성화됨`);
                }
            }

            console.log(`알림 설정 필터 후 수신자: ${filteredUids.size}명`);

            if (filteredUids.size === 0) {
                await docRef.update({ processed: true, recipientCount: recipientUids.size, filteredOut: true });
                return;
            }

            // 알림 내용 생성
            const { title, body } = buildNotificationContent(type, actorName, productName, extraData || {});
            console.log(`알림 내용: ${title} - ${body}`);

            // FCM 토큰 수집
            const tokens = [];
            for (const uid of filteredUids) {
                const tokenSnap = await db.collection("users").doc(uid)
                    .collection("fcmTokens").get();
                console.log(`  ${uid}: FCM 토큰 ${tokenSnap.size}개`);
                tokenSnap.forEach(doc => {
                    const tokenData = doc.data();
                    if (tokenData.token) {
                        tokens.push({ token: tokenData.token, ref: doc.ref });
                    }
                });
            }

            console.log(`총 FCM 토큰: ${tokens.length}개`);

            if (tokens.length === 0) {
                console.log("FCM 토큰 없음, 종료");
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
                        console.error(`FCM 전송 실패 (${token.substring(0, 20)}...):`, error.code, error.message);
                        if (
                            error.code === "messaging/invalid-registration-token" ||
                            error.code === "messaging/registration-token-not-registered"
                        ) {
                            await ref.delete();
                            console.log("만료 토큰 삭제됨");
                        }
                        throw error;
                    })
                )
            );

            const successCount = sendResults.filter(r => r.status === "fulfilled").length;
            const failCount = sendResults.filter(r => r.status === "rejected").length;
            console.log(`FCM 전송 결과: 성공 ${successCount}, 실패 ${failCount}`);

            await docRef.update({
                processed: true,
                recipientCount: filteredUids.size,
                tokenCount: tokens.length,
                successCount
            });

            console.log("=== processNotification 완료 ===");

        } catch (error) {
            console.error("processNotification 에러:", error);
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
