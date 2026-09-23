// DK AS - Storage 보안 규칙 회귀 테스트
//
// 핵심 목적: storage.rules 의 firestore.get() 교차 조회가 실제로 동작하는지 확인.
// 이게 실패하면 사진 업로드/조회가 전부 막히므로 배포 전 반드시 통과해야 한다.

const { describe, it, before, after, beforeEach } = require('node:test');
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'dk-as-rules-test';
const SUPER_EMAIL = 'wnsgurqn2@gmail.com';

const SUPER_UID = 'uid_super';
const USER_UID = 'uid_user';
const PEND_UID = 'uid_pending';

// 1x1 PNG
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

let testEnv;

function st(uid, email) {
    return testEnv.authenticatedContext(uid, { email, email_verified: true }).storage();
}
const asSuper = () => st(SUPER_UID, SUPER_EMAIL);
const asUser = () => st(USER_UID, 'user@corp.com');
const asPending = () => st(PEND_UID, 'pending@corp.com');
const asAnon = () => testEnv.unauthenticatedContext().storage();

before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 8080,
        },
        storage: {
            rules: fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 9199,
        },
    });
});

after(async () => {
    if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await db.doc(`users/${SUPER_UID}`).set({ email: SUPER_EMAIL, approved: true, role: 'superadmin' });
        await db.doc(`users/${USER_UID}`).set({ email: 'user@corp.com', approved: true, role: 'user' });
        await db.doc(`users/${PEND_UID}`).set({ email: 'pending@corp.com', approved: false, role: 'user' });
    });
});

describe('사진 (photos/)', () => {
    it('승인된 일반 사용자: 업로드 가능  ← firestore.get() 교차조회가 동작해야 통과', async () => {
        await assertSucceeds(
            asUser().ref('photos/P001/rental_1_0').put(PNG, { contentType: 'image/png' })
        );
    });

    it('승인된 일반 사용자: 조회 가능', async () => {
        await testEnv.withSecurityRulesDisabled(async (c) => {
            await c.storage().ref('photos/P001/x.png').put(PNG, { contentType: 'image/png' });
        });
        await assertSucceeds(asUser().ref('photos/P001/x.png').getDownloadURL());
    });

    it('총책임자: 업로드 가능', async () => {
        await assertSucceeds(
            asSuper().ref('photos/P001/super.png').put(PNG, { contentType: 'image/png' })
        );
    });

    it('미승인 사용자: 업로드 차단', async () => {
        await assertFails(
            asPending().ref('photos/P001/evil.png').put(PNG, { contentType: 'image/png' })
        );
    });

    it('미승인 사용자: 조회 차단  ← 고객 현장사진 보호', async () => {
        await testEnv.withSecurityRulesDisabled(async (c) => {
            await c.storage().ref('photos/P001/secret.png').put(PNG, { contentType: 'image/png' });
        });
        await assertFails(asPending().ref('photos/P001/secret.png').getDownloadURL());
    });

    it('비로그인: 차단', async () => {
        await assertFails(
            asAnon().ref('photos/P001/anon.png').put(PNG, { contentType: 'image/png' })
        );
    });

    it('이미지가 아닌 파일 업로드 차단', async () => {
        await assertFails(
            asUser().ref('photos/P001/evil.html').put(Buffer.from('<script>alert(1)</script>'), {
                contentType: 'text/html',
            })
        );
    });
});

describe('정의되지 않은 경로', () => {
    it('photos 밖 업로드 차단', async () => {
        await assertFails(
            asUser().ref('other/x.png').put(PNG, { contentType: 'image/png' })
        );
        await assertFails(
            asSuper().ref('other/x.png').put(PNG, { contentType: 'image/png' })
        );
    });
});
