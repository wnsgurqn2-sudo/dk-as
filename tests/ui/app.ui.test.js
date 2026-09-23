// DK AS - 실제 브라우저 UI 테스트
// 이번에 추가/수정한 기능을 진짜 클릭해서 검증한다.
//   1) 제품정보 수정창의 시리얼넘버 입력칸이 실제로 보이는지 (폭 찌그러짐 회귀)
//   2) 시리얼넘버 변경이 저장되는지
//   3) 제품 사진 등록/조회/삭제가 동작하는지
//   + 기존 데이터가 보존되는지

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const puppeteer = require('puppeteer');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');
const { copyApp, startServer, APP_ROOT } = require('./harness');

const PROJECT_ID = 'dk-as-rules-test';
const SUPER_UID = 'uid_super';
const SUPER_EMAIL = 'wnsgurqn2@gmail.com';

let browser, page, server, baseUrl, testEnv, appDir;
const consoleErrors = [];

// 기존 데이터가 보존되는지 확인하기 위한 기준 제품
const BASE_PRODUCT = {
    id: 'U13',
    name: 'SDG25S',
    category: '디젤발전기',
    status: '출고준비완료',
    totalHours: 1000,
    remainingHours: 850,
    serialNumber: 'SN-BFTPZWLW',
    note: '기존비고',
    isRented: false,
    rentalCompany: null,
    rentalHistory: [{ company: '기존업체', rentalDate: '2026-01-01T00:00:00.000Z', returnDate: '2026-02-01T00:00:00.000Z', usedHours: 150 }],
    repairHistory: [{ startDate: '2026-01-05T00:00:00.000Z', endDate: '2026-01-06T00:00:00.000Z', repairItems: '오일교체' }],
    createdAt: '2026-01-01T00:00:00.000Z',
};

// Auth 에뮬레이터는 sub 클레임을 무시하고 자체 uid 를 발급하므로,
// 실제 발급된 uid 를 받아서 사용자 문서를 심는다.
async function seed(uid) {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await db.doc(`users/${uid}`).set({
            email: SUPER_EMAIL, name: '이준혁', department: '영업',
            approved: true, role: 'superadmin',
        });
        await db.doc(`products/${BASE_PRODUCT.id}`).set(BASE_PRODUCT);
        await db.doc('products/U32').set({
            id: 'U32', name: 'SDG25S', category: '디젤발전기', status: '미점검',
            totalHours: 500, remainingHours: 500, serialNumber: 'SN-SECOND01', isRented: false,
        });
    });
}

async function readProduct(id) {
    let data = null;
    await testEnv.withSecurityRulesDisabled(async (c) => {
        const snap = await c.firestore().doc(`products/${id}`).get();
        data = snap.data();
    });
    return data;
}

before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: fs.readFileSync(path.join(APP_ROOT, 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
        storage: { rules: fs.readFileSync(path.join(APP_ROOT, 'storage.rules'), 'utf8'), host: '127.0.0.1', port: 9199 },
    });

    appDir = copyApp();
    const started = await startServer(appDir);
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}/index.html`;

    browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

    await page.evaluateOnNewDocument((uid, email) => {
        window.__TEST_USER__ = { uid, email };
    }, SUPER_UID, SUPER_EMAIL);

    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // 1차: 로그인해서 에뮬레이터가 발급한 실제 uid 확보
    await page.waitForSelector('#googleLoginBtn', { timeout: 30000 });
    const signedInUid = await page.evaluate(async () => {
        const r = await firebase.auth().signInWithPopup();
        return r.user.uid;
    });
    assert.ok(signedInUid, '로그인이 성공해야 함');

    // 그 uid 로 사용자/제품 데이터 시드
    await seed(signedInUid);

    // 2차: 새로고침하면 앱이 승인된 사용자로 인식하고 데이터를 불러옴
    consoleErrors.length = 0; // 로그인 전 노이즈 제거
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });

    await page.waitForFunction(
        () => document.querySelectorAll('#productList .product-manage-item').length > 0,
        { timeout: 40000 }
    );
});

after(async () => {
    if (browser) await browser.close();
    if (server) server.close();
    if (testEnv) await testEnv.cleanup();
    if (appDir) fs.rmSync(appDir, { recursive: true, force: true });
});

// 제품관리 탭으로 이동
async function gotoProductsTab() {
    await page.click('.tab-btn[data-tab="products"]');
    await page.waitForSelector('#products.tab-content.active', { timeout: 10000 });
}

async function openInfoEditModal(productId) {
    await gotoProductsTab();
    await page.click(`#productList .edit-info-btn[data-id="${productId}"]`);
    await page.waitForSelector('#editProductInfoModal.show', { timeout: 10000 });
}

async function openProductModal(productId) {
    await gotoProductsTab();
    await page.click(`#productList .product-manage-item[data-id="${productId}"] .product-info`);
    await page.waitForSelector('#editProductModal.show', { timeout: 10000 });
}

// ===================================================================
describe('앱 기동', () => {
    it('로그인 후 제품 목록이 렌더링된다', async () => {
        const count = await page.$$eval('#productList .product-manage-item', els => els.length);
        assert.strictEqual(count, 2, '제품 2개가 보여야 함');
    });

    it('초기화 단계에서 실패한 기능이 없다', async () => {
        const initErrors = consoleErrors.filter(t => t.includes('초기화 실패'));
        assert.deepStrictEqual(initErrors, [], '초기화 실패가 없어야 함');
    });

    it('외부 라이브러리가 모두 로드된다 (SRI 검증 포함)', async () => {
        const missing = await page.evaluate(() =>
            ['QRCode', 'Html5Qrcode', 'ExcelJS', 'JSZip'].filter(g => typeof window[g] === 'undefined')
        );
        assert.deepStrictEqual(missing, [], '로드 실패 라이브러리가 없어야 함');
    });
});

// ===================================================================
describe('1. 시리얼넘버 입력칸 노출 (회귀)', () => {
    it('제품정보 수정창의 시리얼넘버 입력칸이 실제로 보인다', async () => {
        await openInfoEditModal('U13');

        const box = await page.$eval('#editInfoSerial', el => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return { w: r.width, h: r.height, display: cs.display, visibility: cs.visibility };
        });

        assert.notStrictEqual(box.display, 'none', '표시되어야 함');
        assert.notStrictEqual(box.visibility, 'hidden', '보여야 함');
        assert.ok(box.h > 20, `높이가 있어야 함 (실제 ${box.h})`);
        // 예전 버그: 재발급 버튼이 width:100% 라 입력칸이 0 으로 찌그러졌음
        assert.ok(box.w > 150, `입력칸 폭이 충분해야 함 (실제 ${box.w}px)`);
    });

    it('재발급 버튼이 입력칸을 밀어내지 않는다', async () => {
        const layout = await page.evaluate(() => {
            const input = document.getElementById('editInfoSerial');
            const btn = document.getElementById('editInfoRegenSerial');
            const row = document.querySelector('.edit-info-serial-row');
            return {
                input: input.getBoundingClientRect().width,
                btn: btn.getBoundingClientRect().width,
                row: row.getBoundingClientRect().width,
            };
        });
        assert.ok(layout.btn < layout.row * 0.5, `버튼이 절반 미만이어야 함 (버튼 ${layout.btn}, 행 ${layout.row})`);
        assert.ok(layout.input > layout.btn, '입력칸이 버튼보다 넓어야 함');
    });

    it('모달에 가로 스크롤바가 생기지 않는다', async () => {
        const overflow = await page.$eval('#editProductInfoModal .modal-body', el => ({
            scrollW: el.scrollWidth,
            clientW: el.clientWidth,
        }));
        assert.ok(
            overflow.scrollW <= overflow.clientW + 1,
            `가로 넘침 없어야 함 (scroll ${overflow.scrollW} / client ${overflow.clientW})`
        );
    });

    it('좁은 화면(440px)에서도 입력칸이 보인다', async () => {
        const original = page.viewport();
        await page.setViewport({ width: 440, height: 860 });
        await new Promise(r => setTimeout(r, 300));

        const layout = await page.evaluate(() => {
            const input = document.getElementById('editInfoSerial');
            const btn = document.getElementById('editInfoRegenSerial');
            const body = document.querySelector('#editProductInfoModal .modal-body');
            return {
                input: input.getBoundingClientRect().width,
                btn: btn.getBoundingClientRect().width,
                scrollW: body.scrollWidth,
                clientW: body.clientWidth,
            };
        });

        await page.setViewport(original);
        await new Promise(r => setTimeout(r, 300));

        assert.ok(layout.input > 100, `좁은 화면에서도 입력칸이 보여야 함 (실제 ${layout.input}px)`);
        assert.ok(layout.input > layout.btn, '입력칸이 버튼보다 넓어야 함');
        assert.ok(layout.scrollW <= layout.clientW + 1, '가로 넘침 없어야 함');
    });

    it('기존 시리얼넘버 값이 입력칸에 채워진다', async () => {
        const v = await page.$eval('#editInfoSerial', el => el.value);
        assert.strictEqual(v, 'SN-BFTPZWLW');
    });

    it('QR 하단 라벨 미리보기가 시리얼넘버+제품ID 로 표시된다', async () => {
        const t = await page.$eval('#editInfoLabelPreview', el => el.textContent);
        assert.strictEqual(t, 'SN-BFTPZWLW-U13');
    });
});

// ===================================================================
describe('2. 시리얼넘버 변경', () => {
    it('직접 입력해 변경하면 저장된다', async () => {
        await openInfoEditModal('U13');
        await page.$eval('#editInfoSerial', el => { el.value = ''; });
        await page.type('#editInfoSerial', 'SN-NEWSER01');
        await page.click('#editInfoSave');
        await page.waitForFunction(
            () => !document.getElementById('editProductInfoModal').classList.contains('show'),
            { timeout: 10000 }
        );

        const saved = await readProduct('U13');
        assert.strictEqual(saved.serialNumber, 'SN-NEWSER01');
    });

    it('SN- 접두사 없이 입력해도 자동으로 붙는다', async () => {
        await openInfoEditModal('U13');
        await page.$eval('#editInfoSerial', el => { el.value = ''; });
        await page.type('#editInfoSerial', 'abcd1234');
        await page.click('#editInfoSave');
        await page.waitForFunction(
            () => !document.getElementById('editProductInfoModal').classList.contains('show'),
            { timeout: 10000 }
        );

        const saved = await readProduct('U13');
        assert.strictEqual(saved.serialNumber, 'SN-ABCD1234', '대문자화 + SN- 자동부여');
    });

    it('재발급 버튼이 새 시리얼넘버를 생성한다', async () => {
        await openInfoEditModal('U13');
        const before = await page.$eval('#editInfoSerial', el => el.value);
        await page.click('#editInfoRegenSerial');
        const after = await page.$eval('#editInfoSerial', el => el.value);

        assert.notStrictEqual(after, before, '값이 바뀌어야 함');
        assert.match(after, /^SN-[A-Z0-9]{8}$/);

        const preview = await page.$eval('#editInfoLabelPreview', el => el.textContent);
        assert.strictEqual(preview, `${after}-U13`, '미리보기도 갱신되어야 함');
    });

    it('다른 제품이 쓰는 시리얼넘버는 거부된다', async () => {
        await openInfoEditModal('U13');
        await page.$eval('#editInfoSerial', el => { el.value = ''; });
        await page.type('#editInfoSerial', 'SN-SECOND01'); // U32 가 사용 중
        await page.click('#editInfoSave');

        await page.waitForFunction(
            () => document.getElementById('toast').classList.contains('show'),
            { timeout: 5000 }
        );
        const msg = await page.$eval('#toast', el => el.textContent);
        assert.match(msg, /이미 사용 중/);

        const stillOpen = await page.$eval('#editProductInfoModal', el => el.classList.contains('show'));
        assert.ok(stillOpen, '거부되었으므로 모달이 열려 있어야 함');

        await page.click('#editInfoCancel');
    });

    it('시리얼넘버를 바꿔도 기존 데이터가 보존된다', async () => {
        const saved = await readProduct('U13');
        assert.strictEqual(saved.status, '출고준비완료', '상태 보존');
        assert.strictEqual(saved.createdAt, BASE_PRODUCT.createdAt, '생성일 보존');
        assert.strictEqual(saved.rentalHistory.length, 1, '임대기록 보존');
        assert.strictEqual(saved.rentalHistory[0].company, '기존업체');
        assert.strictEqual(saved.repairHistory.length, 1, '수리기록 보존');
        assert.strictEqual(saved.repairHistory[0].repairItems, '오일교체');
    });
});

// ===================================================================
describe('3. 제품 사진 등록/조회/삭제', () => {
    // 1x1 PNG 를 파일로 만들어 input 에 올린다
    const pngPath = path.join(require('os').tmpdir(), 'dkas-test-photo.png');
    before(() => {
        fs.writeFileSync(pngPath, Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64'
        ));
    });

    it('제품정보 모달에 사진 영역이 있고, 처음엔 비어 있다', async () => {
        await openProductModal('U13');
        const count = await page.$eval('#productPhotoCount', el => el.textContent);
        assert.strictEqual(count, '0');
        const emptyVisible = await page.$eval('#productPhotoEmpty', el => getComputedStyle(el).display !== 'none');
        assert.ok(emptyVisible, '안내문구가 보여야 함');
    });

    it('사진을 등록하면 썸네일이 나타나고 Firestore 에 저장된다', async () => {
        const input = await page.$('#productPhotoGalleryInput');
        await input.uploadFile(pngPath);

        await page.waitForFunction(
            () => document.querySelectorAll('#productPhotoList .photo-item').length === 1,
            { timeout: 30000 }
        );

        const count = await page.$eval('#productPhotoCount', el => el.textContent);
        assert.strictEqual(count, '1');

        const saved = await readProduct('U13');
        assert.ok(Array.isArray(saved.productPhotos), 'productPhotos 배열 존재');
        assert.strictEqual(saved.productPhotos.length, 1);
        assert.match(saved.productPhotos[0], /^http/, '스토리지 URL 이어야 함');
    });

    it('사진 등록이 기존 제품 데이터를 망가뜨리지 않는다', async () => {
        const saved = await readProduct('U13');
        assert.strictEqual(saved.name, 'SDG25S', '제품명 보존');
        assert.strictEqual(saved.status, '출고준비완료', '상태 보존');
        assert.strictEqual(saved.totalHours, 1000, '사용가능시간 보존');
        assert.strictEqual(saved.createdAt, BASE_PRODUCT.createdAt, '생성일 보존');
        assert.strictEqual(saved.rentalHistory.length, 1, '임대기록 보존');
        assert.strictEqual(saved.repairHistory.length, 1, '수리기록 보존');
    });

    it('두 번째 사진을 추가하면 누적된다', async () => {
        const input = await page.$('#productPhotoGalleryInput');
        await input.uploadFile(pngPath);
        await page.waitForFunction(
            () => document.querySelectorAll('#productPhotoList .photo-item').length === 2,
            { timeout: 30000 }
        );
        const saved = await readProduct('U13');
        assert.strictEqual(saved.productPhotos.length, 2, '기존 사진에 누적되어야 함');
    });

    it('썸네일을 클릭하면 확대 모달이 열린다', async () => {
        await page.click('#productPhotoList .photo-item img');
        await page.waitForSelector('.photo-modal-overlay', { timeout: 5000 });
        const src = await page.$eval('.photo-modal-overlay img', el => el.src);
        assert.match(src, /^http/);
        await page.click('.photo-modal-close');
        await page.waitForFunction(() => !document.querySelector('.photo-modal-overlay'), { timeout: 5000 });
    });

    it('사진을 삭제하면 목록과 Firestore 에서 제거된다', async () => {
        await page.click('#productPhotoList .photo-item .photo-delete-btn');
        await page.waitForSelector('#modalOverlay.show', { timeout: 5000 });
        await page.click('#modalConfirm');

        await page.waitForFunction(
            () => document.querySelectorAll('#productPhotoList .photo-item').length === 1,
            { timeout: 30000 }
        );

        const saved = await readProduct('U13');
        assert.strictEqual(saved.productPhotos.length, 1);
    });

    it('모달을 닫았다 다시 열어도 저장된 사진이 보인다', async () => {
        await page.click('#editModalCancel');
        await page.waitForFunction(
            () => !document.getElementById('editProductModal').classList.contains('show'),
            { timeout: 5000 }
        );
        await openProductModal('U13');
        const n = await page.$$eval('#productPhotoList .photo-item', els => els.length);
        assert.strictEqual(n, 1, '저장된 사진이 다시 보여야 함');
    });

    it('사진이 없는 제품은 빈 상태로 표시된다', async () => {
        await page.click('#editModalCancel');
        await page.waitForFunction(
            () => !document.getElementById('editProductModal').classList.contains('show'),
            { timeout: 5000 }
        );
        await openProductModal('U32');
        const n = await page.$$eval('#productPhotoList .photo-item', els => els.length);
        assert.strictEqual(n, 0, '다른 제품 사진이 섞이면 안 됨');
        await page.click('#editModalCancel');
    });
});

// ===================================================================
describe('콘솔 오류', () => {
    it('치명적인 자바스크립트 오류가 없다', async () => {
        const fatal = consoleErrors.filter(t =>
            t.includes('pageerror:') ||
            t.includes('is not a function') ||
            t.includes('is not defined') ||
            t.includes('Cannot read')
        );
        assert.deepStrictEqual(fatal, [], '런타임 오류가 없어야 함');
    });
});
