// DK AS - 순수 함수 단위 테스트 (에뮬레이터 불필요)
// 실행: npm run test:unit
//
// app.js 에서 순수 함수 부분만 떼어내 검증한다.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// app.js 의 특정 구간을 잘라내 평가하는 헬퍼
function loadSection(startMarker, endMarker) {
    const s = SRC.indexOf(startMarker);
    const e = SRC.indexOf(endMarker);
    assert.ok(s !== -1, `시작 마커를 찾지 못함: ${startMarker}`);
    assert.ok(e !== -1 && e > s, `끝 마커를 찾지 못함: ${endMarker}`);
    return SRC.slice(s, e);
}

// esc / escJs
eval(loadSection('function esc(str)', '// ===== 사진 리사이즈'));
// normalizeSerial / getQRSerialLabel / fitFontSizeToWidth
eval(loadSection('function normalizeSerial(raw)', '// 상태별 진행률'));
// describeFirestoreError
eval(loadSection('function describeFirestoreError(e, prefix)', '// Firestore 배치는'));

// ===================================================================
describe('esc() - HTML 이스케이프', () => {
    it('null/undefined 는 빈 문자열', () => {
        assert.strictEqual(esc(null), '');
        assert.strictEqual(esc(undefined), '');
    });

    it('숫자 0 과 false 는 그대로 표시된다 (예전 버그)', () => {
        assert.strictEqual(esc(0), '0');
        assert.strictEqual(esc(false), 'false');
    });

    it('태그 주입을 차단한다', () => {
        assert.strictEqual(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    });

    it('속성 탈출을 차단한다', () => {
        assert.strictEqual(esc('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)');
        assert.strictEqual(esc("' onfocus='alert(1)"), '&#39; onfocus=&#39;alert(1)');
    });

    it('앰퍼샌드를 먼저 치환해 이중 이스케이프가 안 깨진다', () => {
        assert.strictEqual(esc('&lt;'), '&amp;lt;');
    });

    it('출력에 마크업 원문자가 남지 않는다', () => {
        assert.ok(!/[<>"']/.test(esc(`<img src=x onerror="fetch('//evil')">`)));
    });
});

describe('escJs() - 인라인 핸들러 문자열 이스케이프', () => {
    it('홑따옴표를 탈출 불가능하게 만든다', () => {
        assert.strictEqual(escJs("'); alert(1); ('"), "\\'); alert(1); (\\'");
    });

    it('역슬래시를 이스케이프한다', () => {
        assert.strictEqual(escJs('a\\b'), 'a\\\\b');
    });

    it('script 종료 태그를 무력화한다', () => {
        assert.strictEqual(escJs('</script>'), '\\x3C/script>');
    });

    it('핸들러에 넣어도 인자가 원문 그대로 전달된다 (코드 실행 아님)', () => {
        const payload = `x'); alert(1); ('`;
        let captured = null;
        global.showPhotoModal = (v) => { captured = v; };
        eval(`showPhotoModal('${escJs(payload)}')`);
        assert.strictEqual(captured, payload);
    });

    it('대조군: 이스케이프 없이는 실제로 코드가 실행된다', () => {
        const payload = `x'); alert(1); ('`;
        let escaped = false;
        global.alert = () => { escaped = true; };
        global.showPhotoModal = () => {};
        eval(`showPhotoModal('${payload}')`);
        assert.strictEqual(escaped, true);
    });
});

// ===================================================================
describe('normalizeSerial() - 시리얼넘버 정규화', () => {
    it('SN- 접두사를 자동으로 붙인다', () => {
        assert.strictEqual(normalizeSerial('abcd1234'), 'SN-ABCD1234');
    });

    it('이미 SN- 이 있으면 중복되지 않는다', () => {
        assert.strictEqual(normalizeSerial('SN-ABCD1234'), 'SN-ABCD1234');
        assert.strictEqual(normalizeSerial('sn-abcd1234'), 'SN-ABCD1234');
    });

    it('SN (하이픈 없음) 도 처리한다', () => {
        assert.strictEqual(normalizeSerial('SNABCD1234'), 'SN-ABCD1234');
    });

    it('허용되지 않는 문자를 제거한다', () => {
        assert.strictEqual(normalizeSerial('AB-12 CD/34'), 'SN-AB12CD34');
    });

    it('빈 값은 빈 문자열', () => {
        assert.strictEqual(normalizeSerial(''), '');
        assert.strictEqual(normalizeSerial('   '), '');
        assert.strictEqual(normalizeSerial(null), '');
        assert.strictEqual(normalizeSerial('SN-'), '');
    });
});

describe('getQRSerialLabel() - QR 하단 라벨', () => {
    it('시리얼넘버 + 제품ID 를 결합한다', () => {
        assert.strictEqual(getQRSerialLabel({ serialNumber: 'SN-AB12CD34', id: 'P001' }), 'SN-AB12CD34-P001');
    });

    it('한쪽만 있으면 있는 쪽만 쓴다', () => {
        assert.strictEqual(getQRSerialLabel({ serialNumber: '', id: 'P007' }), 'P007');
        assert.strictEqual(getQRSerialLabel({ serialNumber: 'SN-XYZ', id: '' }), 'SN-XYZ');
    });

    it('제품이 없으면 빈 문자열', () => {
        assert.strictEqual(getQRSerialLabel(null), '');
    });
});

describe('fitFontSizeToWidth() - 폰트 폭 맞춤', () => {
    // monospace 근사: 글자폭 = size * 0.6
    const ctx = {
        font: '',
        measureText(text) {
            const size = parseInt(this.font.match(/(\d+)px/)[1], 10);
            return { width: text.length * size * 0.6 };
        }
    };
    const build = (s) => `bold ${s}px monospace`;

    function check(label, maxWidth) {
        const cap = Math.round(maxWidth * 0.5);
        const size = fitFontSizeToWidth(ctx, label, maxWidth, build, 10, cap);
        ctx.font = build(size);
        const w = ctx.measureText(label).width;
        ctx.font = build(size + 1);
        const wNext = ctx.measureText(label).width;
        return { size, w, maximal: wNext > maxWidth || size >= cap };
    }

    it('폭을 넘지 않으면서 최대 크기를 찾는다', () => {
        const r = check('SN-AB12CD34-P001', 512);
        assert.ok(r.w <= 512, '폭을 넘지 않아야 함');
        assert.ok(r.maximal, '한 단계 더 키우면 넘쳐야 함(=최대)');
        assert.ok(r.w / 512 > 0.9, `폭을 90% 이상 채워야 함 (실제 ${(r.w / 512 * 100).toFixed(0)}%)`);
    });

    it('긴 라벨도 폭 안에 들어간다', () => {
        const r = check('SN-AB12CD34-P0000001', 512);
        assert.ok(r.w <= 512);
        assert.ok(r.maximal);
    });

    it('좁은 폭(모달 120px)에서도 동작한다', () => {
        const r = check('SN-AB12CD34-P001', 120);
        assert.ok(r.w <= 120);
        assert.ok(r.maximal);
    });

    it('짧은 라벨은 상한에서 멈춘다', () => {
        const r = check('P1', 512);
        assert.strictEqual(r.size, 256, '상한 = maxWidth * 0.5');
    });

    it('빈 문자열은 최소 크기', () => {
        assert.strictEqual(fitFontSizeToWidth(ctx, '', 512, build, 10, 256), 10);
    });
});

// ===================================================================
describe('describeFirestoreError() - 오류 문구', () => {
    it('권한 거부를 명확히 안내한다', () => {
        assert.match(describeFirestoreError({ code: 'permission-denied' }, '실패'), /권한/);
    });

    it('인증 만료를 안내한다', () => {
        assert.match(describeFirestoreError({ code: 'unauthenticated' }, '실패'), /로그인/);
    });

    it('네트워크 오류를 안내한다', () => {
        assert.match(describeFirestoreError({ code: 'unavailable' }, '실패'), /네트워크/);
        assert.match(describeFirestoreError({ code: 'deadline-exceeded' }, '실패'), /네트워크/);
    });

    it('알 수 없는 오류는 원본 메시지를 보여준다', () => {
        assert.match(describeFirestoreError({ code: 'weird', message: 'zzz' }, '실패'), /zzz/);
    });

    it('code 가 없어도 죽지 않는다', () => {
        assert.ok(describeFirestoreError(null, '실패').length > 0);
        assert.ok(describeFirestoreError({}, '실패').length > 0);
    });
});

// ===================================================================
describe('app.js 구조 검증', () => {
    it('초기화 목록의 함수가 모두 정의돼 있다', () => {
        const registered = [...SRC.matchAll(/\['([^']+)',\s*(init\w+)\]/g)].map(m => m[2]);
        assert.ok(registered.length >= 19, `초기화 등록이 충분해야 함 (현재 ${registered.length})`);
        const missing = registered.filter(fn => !new RegExp(`function\\s+${fn}\\s*\\(`).test(SRC));
        assert.deepStrictEqual(missing, [], '미정의 초기화 함수가 없어야 함');
    });

    it('전역 오류 안전망이 등록돼 있다', () => {
        assert.match(SRC, /addEventListener\('unhandledrejection'/);
    });

    it('window.history 를 가리는 전역 history 가 없다', () => {
        assert.ok(!/^let history\s*=/m.test(SRC), 'appHistory 로 개명되어 있어야 함');
        assert.match(SRC, /let appHistory\s*=/);
    });

    it('제품 사진은 merge 로 저장해 기존 필드를 보존한다', () => {
        const photoWrites = [...SRC.matchAll(/productPhotos:[\s\S]{0,200}?\{ merge: true \}/g)];
        assert.ok(photoWrites.length >= 2, `사진 저장/삭제가 merge 여야 함 (발견 ${photoWrites.length})`);
    });

    it('Firestore 배치는 500개 제한에 맞춰 분할된다', () => {
        assert.match(SRC, /FIRESTORE_BATCH_LIMIT\s*=\s*(4\d\d|[1-4]\d\d)/);
        assert.match(SRC, /function commitInChunks/);
    });
});
