// DK AS - Firestore 보안 규칙 회귀 테스트
// 실행: npm test   (firebase emulators:exec 가 감싸서 실행)
//
// 핵심 목적:
//  1) 총책임자가 아닌 "일반 사용자" 경로가 실제로 동작하는지 (운영 미검증 구간)
//  2) 권한 상승(approved/role 자기수정)이 정말 차단되는지
//  3) 미승인 계정이 데이터에 접근하지 못하는지

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'dk-as-rules-test';
const SUPER_EMAIL = 'wnsgurqn2@gmail.com';

// 테스트 배우들
const SUPER_UID = 'uid_super';
const USER_UID = 'uid_user';      // 승인된 일반 사용자
const ADMIN_UID = 'uid_admin';    // 승인된 관리자
const PEND_UID = 'uid_pending';   // 미승인 사용자
const OTHER_UID = 'uid_other';    // 다른 일반 사용자

let testEnv;

function ctx(uid, email) {
    return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
}
const asSuper = () => ctx(SUPER_UID, SUPER_EMAIL);
const asUser = () => ctx(USER_UID, 'user@corp.com');
const asAdmin = () => ctx(ADMIN_UID, 'admin@corp.com');
const asPending = () => ctx(PEND_UID, 'pending@corp.com');
const asAnon = () => testEnv.unauthenticatedContext().firestore();

before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 8080,
        },
    });
});

after(async () => {
    if (testEnv) await testEnv.cleanup();
});

// 매 테스트 전에 규칙을 우회해 기준 데이터를 심는다
beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await db.doc(`users/${SUPER_UID}`).set({
            email: SUPER_EMAIL, name: '총책임자', department: '관리', approved: true, role: 'superadmin',
        });
        await db.doc(`users/${USER_UID}`).set({
            email: 'user@corp.com', name: '일반', department: '영업', approved: true, role: 'user',
        });
        await db.doc(`users/${ADMIN_UID}`).set({
            email: 'admin@corp.com', name: '관리자', department: '관리', approved: true, role: 'admin',
        });
        await db.doc(`users/${PEND_UID}`).set({
            email: 'pending@corp.com', name: '대기', department: '영업', approved: false, role: 'user',
        });
        await db.doc(`users/${OTHER_UID}`).set({
            email: 'other@corp.com', name: '다른', department: '영업', approved: true, role: 'user',
        });
        await db.doc('products/P001').set({
            id: 'P001', name: '에어컨', category: '에어컨', status: '미점검',
            totalHours: 1000, remainingHours: 1000, serialNumber: 'SN-TEST0001',
        });
        await db.doc('history/H001').set({
            type: '상태변경', productId: 'P001', userId: USER_UID, time: new Date().toISOString(),
        });
    });
});

// ===================================================================
describe('제품 (products)', () => {
    it('일반 사용자: 읽기 가능  ← 운영 미검증이던 핵심 경로', async () => {
        await assertSucceeds(asUser().doc('products/P001').get());
    });

    it('일반 사용자: 상태변경 저장 가능  ← 핵심 경로', async () => {
        await assertSucceeds(
            asUser().doc('products/P001').set({ status: '수리중' }, { merge: true })
        );
    });

    it('일반 사용자: 목록 조회 가능', async () => {
        await assertSucceeds(asUser().collection('products').get());
    });

    it('일반 사용자: 제품 등록/삭제 가능', async () => {
        await assertSucceeds(asUser().doc('products/P999').set({ id: 'P999', name: '신규' }));
        await assertSucceeds(asUser().doc('products/P001').delete());
    });

    it('관리자: 읽기/쓰기 가능', async () => {
        await assertSucceeds(asAdmin().doc('products/P001').get());
        await assertSucceeds(asAdmin().doc('products/P001').set({ status: '청소중' }, { merge: true }));
    });

    it('총책임자: 읽기/쓰기 가능', async () => {
        await assertSucceeds(asSuper().doc('products/P001').get());
        await assertSucceeds(asSuper().doc('products/P001').set({ status: '완료' }, { merge: true }));
    });

    it('미승인 사용자: 읽기 차단', async () => {
        await assertFails(asPending().doc('products/P001').get());
    });

    it('미승인 사용자: 쓰기 차단', async () => {
        await assertFails(asPending().doc('products/P001').set({ status: '해킹' }, { merge: true }));
    });

    it('비로그인: 차단', async () => {
        await assertFails(asAnon().doc('products/P001').get());
        await assertFails(asAnon().doc('products/P001').set({ status: 'x' }, { merge: true }));
    });
});

// ===================================================================
describe('권한 상승 차단 (users)', () => {
    it('일반 사용자: 스스로 approved=true 변경 차단', async () => {
        await assertFails(asPending().doc(`users/${PEND_UID}`).update({ approved: true }));
    });

    it('일반 사용자: 스스로 role=admin 변경 차단', async () => {
        await assertFails(asUser().doc(`users/${USER_UID}`).update({ role: 'admin' }));
    });

    it('일반 사용자: 스스로 role=superadmin 변경 차단', async () => {
        await assertFails(asUser().doc(`users/${USER_UID}`).update({ role: 'superadmin' }));
    });

    it('일반 사용자: 스스로 manualRentalPermission 부여 차단', async () => {
        await assertFails(asUser().doc(`users/${USER_UID}`).update({ manualRentalPermission: true }));
    });

    it('일반 사용자: name/department 변경은 허용', async () => {
        await assertSucceeds(asUser().doc(`users/${USER_UID}`).update({ name: '새이름' }));
        await assertSucceeds(asUser().doc(`users/${USER_UID}`).update({ department: '새부서' }));
    });

    it('일반 사용자: notificationSettings 변경은 허용', async () => {
        await assertSucceeds(
            asUser().doc(`users/${USER_UID}`).update({ notificationSettings: { rental: false } })
        );
    });

    // 주의: affectedKeys()는 "값이 실제로 바뀐" 필드만 반환한다.
    // 따라서 이미 approved=true 인 계정이 approved=true 로 다시 쓰는 것은
    // 변경으로 잡히지 않으며, 그건 권한 상승이 아니므로 안전하다.
    // 진짜 공격은 approved=false 인 계정이 true 로 바꾸려는 경우다.
    it('허용 필드에 approved 상승을 섞어도 차단 (미승인 계정)', async () => {
        await assertFails(
            asPending().doc(`users/${PEND_UID}`).update({ name: '새이름', approved: true })
        );
    });

    it('허용 필드에 role 상승을 섞어도 차단', async () => {
        await assertFails(
            asUser().doc(`users/${USER_UID}`).update({ name: '새이름', role: 'admin' })
        );
    });

    it('값이 바뀌지 않는 동일값 쓰기는 권한 상승이 아님 (허용)', async () => {
        // approved 가 이미 true 인 계정이 true 로 다시 쓰는 것 = 변경 없음
        await assertSucceeds(
            asUser().doc(`users/${USER_UID}`).update({ name: '새이름', approved: true })
        );
    });

    it('일반 사용자: 남의 문서 수정 차단', async () => {
        await assertFails(asUser().doc(`users/${OTHER_UID}`).update({ name: '조작' }));
    });

    it('일반 사용자: 남의 문서 삭제 차단', async () => {
        await assertFails(asUser().doc(`users/${OTHER_UID}`).delete());
    });

    it('총책임자: 승인/역할변경 가능', async () => {
        await assertSucceeds(asSuper().doc(`users/${PEND_UID}`).update({ approved: true, role: 'user' }));
        await assertSucceeds(asSuper().doc(`users/${USER_UID}`).update({ role: 'admin' }));
        await assertSucceeds(asSuper().doc(`users/${USER_UID}`).update({ manualRentalPermission: true }));
    });

    it('관리자: 남을 승인할 수 없음 (총책임자 전용)', async () => {
        await assertFails(asAdmin().doc(`users/${PEND_UID}`).update({ approved: true }));
    });
});

// ===================================================================
describe('사용자 문서 읽기', () => {
    it('본인 문서는 미승인이어도 읽기 가능  ← 승인대기 화면이 이걸 씀', async () => {
        await assertSucceeds(asPending().doc(`users/${PEND_UID}`).get());
    });

    it('관리자: 전체 사용자 목록 조회 가능  ← 히스토리 탭 사용자 필터', async () => {
        await assertSucceeds(asAdmin().collection('users').get());
    });

    it('총책임자: 전체 사용자 목록 조회 가능  ← 승인설정 화면', async () => {
        await assertSucceeds(asSuper().collection('users').get());
    });

    it('일반 사용자: 전체 사용자 목록 조회 차단', async () => {
        await assertFails(asUser().collection('users').get());
    });

    it('일반 사용자: 남의 문서 단건 조회 차단', async () => {
        await assertFails(asUser().doc(`users/${OTHER_UID}`).get());
    });
});

// ===================================================================
describe('신규 가입 (users create)', () => {
    it('미승인 + role=user 로만 생성 가능', async () => {
        const db = ctx('uid_new', 'new@corp.com');
        await assertSucceeds(db.doc('users/uid_new').set({
            email: 'new@corp.com', name: '신입', department: '영업', approved: false, role: 'user',
        }));
    });

    it('가입하면서 approved=true 는 차단', async () => {
        const db = ctx('uid_new2', 'new2@corp.com');
        await assertFails(db.doc('users/uid_new2').set({
            email: 'new2@corp.com', name: '신입', department: '영업', approved: true, role: 'user',
        }));
    });

    it('가입하면서 role=admin 은 차단', async () => {
        const db = ctx('uid_new3', 'new3@corp.com');
        await assertFails(db.doc('users/uid_new3').set({
            email: 'new3@corp.com', name: '신입', department: '영업', approved: false, role: 'admin',
        }));
    });

    it('남의 이메일로 문서 생성 차단', async () => {
        const db = ctx('uid_new4', 'new4@corp.com');
        await assertFails(db.doc('users/uid_new4').set({
            email: SUPER_EMAIL, name: '사칭', department: '영업', approved: false, role: 'user',
        }));
    });

    it('남의 uid 로 문서 생성 차단', async () => {
        const db = ctx('uid_new5', 'new5@corp.com');
        await assertFails(db.doc('users/uid_evil').set({
            email: 'new5@corp.com', name: 'x', department: 'x', approved: false, role: 'user',
        }));
    });
});

// ===================================================================
describe('히스토리 (history)', () => {
    it('일반 사용자: 본인 uid 로 기록 생성 가능  ← 상태변경이 이걸 씀', async () => {
        await assertSucceeds(asUser().collection('history').add({
            type: '상태변경', productId: 'P001', userId: USER_UID, time: new Date().toISOString(),
        }));
    });

    it('일반 사용자: 읽기 가능', async () => {
        await assertSucceeds(asUser().doc('history/H001').get());
    });

    it('userId 없이 기록 생성 차단', async () => {
        await assertFails(asUser().collection('history').add({
            type: '상태변경', productId: 'P001', time: new Date().toISOString(),
        }));
    });

    it('남의 uid 로 기록 위조 차단', async () => {
        await assertFails(asUser().collection('history').add({
            type: '상태변경', productId: 'P001', userId: OTHER_UID, time: new Date().toISOString(),
        }));
    });

    it('일반 사용자: 기록 수정 차단', async () => {
        await assertFails(asUser().doc('history/H001').update({ type: '조작' }));
    });

    it('일반 사용자: 기록 삭제 차단  ← 예전엔 아무나 전체 삭제 가능했음', async () => {
        await assertFails(asUser().doc('history/H001').delete());
    });

    it('관리자도 기록 삭제 차단', async () => {
        await assertFails(asAdmin().doc('history/H001').delete());
    });

    it('총책임자: 기록 삭제 가능', async () => {
        await assertSucceeds(asSuper().doc('history/H001').delete());
    });

    it('미승인 사용자: 읽기/쓰기 차단', async () => {
        await assertFails(asPending().doc('history/H001').get());
        await assertFails(asPending().collection('history').add({ userId: PEND_UID, type: 'x' }));
    });
});

// ===================================================================
describe('알림 (notifications)', () => {
    it('일반 사용자: 본인 actorUid 로 생성 가능', async () => {
        await assertSucceeds(asUser().collection('notifications').add({
            type: 'status_change', actorUid: USER_UID, productName: '에어컨', processed: false,
        }));
    });

    it('남의 actorUid 로 위조 차단', async () => {
        await assertFails(asUser().collection('notifications').add({
            type: 'status_change', actorUid: SUPER_UID, productName: '에어컨', processed: false,
        }));
    });

    it('읽기 차단 (Cloud Functions 전용)', async () => {
        await assertFails(asSuper().collection('notifications').get());
    });

    it('미승인 사용자: 생성 차단', async () => {
        await assertFails(asPending().collection('notifications').add({
            type: 'x', actorUid: PEND_UID,
        }));
    });
});

// ===================================================================
describe('FCM 토큰', () => {
    it('본인 토큰 저장 가능', async () => {
        await assertSucceeds(
            asUser().doc(`users/${USER_UID}/fcmTokens/t_1`).set({ token: 'abc' })
        );
    });

    it('남의 토큰 읽기 차단', async () => {
        await assertFails(asUser().doc(`users/${OTHER_UID}/fcmTokens/t_1`).get());
    });

    it('남의 토큰 쓰기 차단', async () => {
        await assertFails(
            asUser().doc(`users/${OTHER_UID}/fcmTokens/t_1`).set({ token: 'evil' })
        );
    });
});

// ===================================================================
describe('정의되지 않은 경로', () => {
    it('임의 컬렉션 접근 차단', async () => {
        await assertFails(asSuper().doc('secrets/s1').get());
        await assertFails(asUser().doc('secrets/s1').set({ a: 1 }));
    });
});
