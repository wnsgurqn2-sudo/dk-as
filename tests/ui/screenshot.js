// 수동 확인용 스크린샷 생성기
// 실행: firebase emulators:exec --only auth,firestore,storage --project dk-as-rules-test "node tests/ui/screenshot.js"

const puppeteer = require('puppeteer');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');
const { copyApp, startServer, APP_ROOT } = require('./harness');

const OUT = process.env.SHOT_DIR || path.join(APP_ROOT, 'tests', 'ui', 'shots');

(async () => {
    fs.mkdirSync(OUT, { recursive: true });

    const testEnv = await initializeTestEnvironment({
        projectId: 'dk-as-rules-test',
        firestore: { rules: fs.readFileSync(path.join(APP_ROOT, 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
        storage: { rules: fs.readFileSync(path.join(APP_ROOT, 'storage.rules'), 'utf8'), host: '127.0.0.1', port: 9199 },
    });

    const dir = copyApp();
    const { server, port } = await startServer(dir);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 1000 });
    await page.evaluateOnNewDocument(() => {
        window.__TEST_USER__ = { uid: 'x', email: 'wnsgurqn2@gmail.com' };
    });

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#googleLoginBtn', { timeout: 30000 });
    const uid = await page.evaluate(async () => (await firebase.auth().signInWithPopup()).user.uid);

    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await db.doc(`users/${uid}`).set({ email: 'wnsgurqn2@gmail.com', name: '이준혁', department: '영업', approved: true, role: 'superadmin' });
        await db.doc('products/U13').set({
            id: 'U13', name: 'SDG25S', category: '디젤발전기', status: '출고준비완료',
            totalHours: 1000, remainingHours: 850, serialNumber: 'SN-BFTPZWLW', isRented: false,
        });
    });

    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('#productList .product-manage-item').length > 0, { timeout: 40000 });

    // 1) 제품정보 수정창 (시리얼넘버 입력칸)
    await page.click('.tab-btn[data-tab="products"]');
    await page.waitForSelector('#products.tab-content.active');
    await page.click('#productList .edit-info-btn[data-id="U13"]');
    await page.waitForSelector('#editProductInfoModal.show');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, '1-제품정보수정-시리얼넘버.png') });
    await page.click('#editInfoCancel');

    // 2) 제품정보 모달 (사진 영역)
    await page.click('#productList .product-manage-item[data-id="U13"] .product-info');
    await page.waitForSelector('#editProductModal.show');
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(OUT, '2-제품정보-사진영역.png') });

    // 3) 사진 등록 후
    const png = path.join(require('os').tmpdir(), 'shot-photo.png');
    fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAPElEQVR42u3QMQEAAAgDoC252H8ChwZkkKSqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwOQtVAAGTVQYyAAAAAElFTkSuQmCC', 'base64'));
    const input = await page.$('#productPhotoGalleryInput');
    await input.uploadFile(png);
    await page.waitForFunction(() => document.querySelectorAll('#productPhotoList .photo-item').length === 1, { timeout: 30000 });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(OUT, '3-사진등록완료.png') });

    // 4) 모바일 폭
    await page.setViewport({ width: 440, height: 860, isMobile: true });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(OUT, '4-모바일-제품정보.png') });
    // 모바일 폭에서는 요소가 스크롤 밖에 있을 수 있어 JS 클릭 사용
    await page.evaluate(() => document.getElementById('editModalCancel').click());
    await page.waitForFunction(() => !document.getElementById('editProductModal').classList.contains('show'));
    await page.evaluate(() => document.querySelector('#productList .edit-info-btn[data-id="U13"]').click());
    await page.waitForSelector('#editProductInfoModal.show');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, '5-모바일-제품정보수정.png') });

    console.log('스크린샷 저장 위치: ' + OUT);
    fs.readdirSync(OUT).forEach(f => console.log('  ' + f));

    await browser.close();
    server.close();
    await testEnv.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
