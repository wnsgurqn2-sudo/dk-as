// UI 테스트 하네스
// 앱을 임시 폴더로 복사 → firebase-config 를 에뮬레이터용으로 교체
// → 에뮬레이터 접속 패치 스크립트 주입 → 정적 서버 기동
//
// 운영 프로젝트에는 절대 접속하지 않는다.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const APP_ROOT = path.join(__dirname, '..', '..');

// index.html 에 주입할 에뮬레이터 접속 패치.
// app.js 는 DOMContentLoaded 안에서 firebase.firestore() 등을 호출하므로,
// app.js 다음에 이 스크립트를 두면 팩토리 함수를 가로챌 수 있다.
const EMULATOR_PATCH = `
<script>
(function () {
  var HOST = '127.0.0.1';
  function patch(name, setup) {
    var orig = firebase[name];
    var wrapped = function () {
      var inst = orig.apply(firebase, arguments);
      if (!inst.__emuDone) { setup(inst); inst.__emuDone = true; }
      return inst;
    };
    // firebase.firestore.FieldValue 같은 정적 속성 보존
    Object.getOwnPropertyNames(orig).forEach(function (k) {
      if (k === 'length' || k === 'name' || k === 'prototype') return;
      try {
        Object.defineProperty(wrapped, k, Object.getOwnPropertyDescriptor(orig, k));
      } catch (e) {}
    });
    firebase[name] = wrapped;
  }

  patch('firestore', function (db) { db.useEmulator(HOST, 8080); });
  patch('storage', function (s) { s.useEmulator(HOST, 9199); });
  patch('auth', function (a) {
    a.useEmulator('http://' + HOST + ':9099', { disableWarnings: true });
    // 구글 팝업 로그인을 에뮬레이터용 가짜 자격증명 로그인으로 대체
    a.signInWithPopup = function () {
      var u = window.__TEST_USER__ || { uid: 'uid_super', email: 'wnsgurqn2@gmail.com' };
      var cred = firebase.auth.GoogleAuthProvider.credential(
        JSON.stringify({ sub: u.uid, email: u.email, email_verified: true })
      );
      return a.signInWithCredential(cred);
    };
  });

  window.__EMULATOR_READY__ = true;
})();
</script>
`;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
};

function copyApp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dkas-ui-'));

    const files = ['index.html', 'app.js', 'styles.css', 'notifications.js', 'manifest.json'];
    for (const f of files) {
        fs.copyFileSync(path.join(APP_ROOT, f), path.join(dir, f));
    }
    // 아이콘 폴더 (없어도 테스트에는 지장 없음)
    // 주의: fs.cpSync 는 이 환경(Windows/Node 22)에서 네이티브 크래시를 일으키므로
    //       readdir + copyFileSync 로 얕은 복사를 한다.
    const iconsSrc = path.join(APP_ROOT, 'icons');
    if (fs.existsSync(iconsSrc)) {
        const iconsDst = path.join(dir, 'icons');
        fs.mkdirSync(iconsDst, { recursive: true });
        for (const name of fs.readdirSync(iconsSrc)) {
            const from = path.join(iconsSrc, name);
            try {
                if (fs.statSync(from).isFile()) {
                    fs.copyFileSync(from, path.join(iconsDst, name));
                }
            } catch (e) {
                // 아이콘은 테스트에 필수가 아니므로 실패해도 계속 진행
            }
        }
    }

    // 에뮬레이터용 설정으로 교체
    fs.copyFileSync(path.join(__dirname, 'emulator-config.js'), path.join(dir, 'firebase-config.js'));

    // index.html 수정: app.js 뒤에 패치 주입 + 서비스워커 등록 제거(테스트 노이즈 차단)
    let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

    const appTag = html.match(/<script src="app\.js[^"]*"><\/script>/);
    if (!appTag) throw new Error('index.html 에서 app.js 스크립트 태그를 찾지 못했습니다.');
    html = html.replace(appTag[0], appTag[0] + EMULATOR_PATCH);

    html = html.replace(/if \('serviceWorker' in navigator\)/, "if (false && 'serviceWorker' in navigator)");

    // 로그인 배경(three.js)은 테스트에 불필요하고 외부 CDN 의존이라 제거
    html = html.replace(/<script type="module" src="login-bg\.js[^"]*"><\/script>/, '');

    fs.writeFileSync(path.join(dir, 'index.html'), html);
    return dir;
}

function startServer(rootDir) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let urlPath = decodeURIComponent(req.url.split('?')[0]);
            if (urlPath === '/') urlPath = '/index.html';
            const filePath = path.join(rootDir, urlPath);
            if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
            fs.createReadStream(filePath).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port });
        });
    });
}

module.exports = { copyApp, startServer, APP_ROOT };
