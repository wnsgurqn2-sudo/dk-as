# 테스트

**배포 전에 `npm test` 를 실행하세요.** 총 112건.

| 명령 | 건수 | 내용 | 에뮬레이터 |
|---|---|---|---|
| `npm run test:unit` | 34 | 순수 함수 (이스케이프, 시리얼넘버, QR 라벨, 오류문구, 구조 검증) | 불필요 |
| `npm run test:rules` | 57 | Firestore / Storage 보안 규칙 | 필요 |
| `npm run test:ui` | 21 | 실제 브라우저에서 화면 조작 | 필요 |
| `npm test` | 112 | 위 전부 | 필요 |

에뮬레이터는 자동으로 뜨고 끝나면 자동 종료됩니다.
운영 데이터베이스는 **전혀 건드리지 않습니다** (로컬 에뮬레이터 전용).

## 화면 눈으로 확인하기

```bash
firebase emulators:exec --only auth,firestore,storage --project dk-as-rules-test "node tests/ui/screenshot.js"
```

`tests/ui/shots/` 에 PC·모바일 화면 캡처가 저장됩니다.

## 사전 요구사항

| 항목 | 확인 |
|---|---|
| Node.js | `node --version` |
| Java (JDK 17+) | `java -version` — 에뮬레이터가 Java 프로그램이라 필수 |
| firebase CLI | `firebase --version` |

Java가 없다면:
```powershell
winget install Microsoft.OpenJDK.21
```
설치 후 **터미널을 새로 열어야** PATH가 잡힙니다.

## 테스트가 검증하는 것

### `firestore.rules.test.js` (49건)

- **일반 사용자 경로** — 승인된 일반 사용자가 제품 조회·상태변경·기록 생성이 되는지
  (총책임자는 `isSuperAdmin()`에서 즉시 통과하므로, 총책임자로만 테스트하면 나머지 규칙이 전혀 검증되지 않습니다)
- **권한 상승 차단** — 본인 문서의 `approved` / `role` / `manualRentalPermission` 수정 불가
- **미승인 계정 차단** — 제품·히스토리·알림 전부 접근 불가
- **신규 가입** — `approved: false` + `role: 'user'` 로만 생성 가능, 남의 이메일/uid 사칭 불가
- **히스토리** — 본인 uid로 생성만 가능, 수정·삭제는 총책임자만
- **알림** — `actorUid` 위조 불가
- **FCM 토큰** — 본인 것만 접근 가능

### `storage.rules.test.js` (8건)

- 승인된 사용자만 사진 업로드/조회 가능 (`firestore.get()` 교차 조회 동작 확인)
- 미승인 계정의 현장사진 조회 차단
- 이미지가 아닌 파일 업로드 차단

### `ui/app.ui.test.js` (21건) — 실제 브라우저

Puppeteer 로 앱을 띄워 진짜 클릭한다. 앱은 임시 폴더로 복사되고
`firebase-config.js` 가 에뮬레이터용으로 교체되므로 운영 프로젝트에 접속하지 않는다.

- 제품정보 수정창의 시리얼넘버 입력칸 폭 (`.btn-secondary` 의 `width:100%` 회귀)
- 시리얼넘버 변경 · `SN-` 자동 부여 · 재발급 · 중복 거부
- 제품 사진 등록 / 누적 / 확대 / 삭제 / 재조회
- **사진·시리얼 변경이 기존 데이터(상태·생성일·임대기록·수리기록)를 보존하는지**
- 초기화 실패 · 라이브러리 로드 실패 · 런타임 오류 없음

**참고**: Auth 에뮬레이터는 `sub` 클레임을 무시하고 자체 uid 를 발급한다.
그래서 테스트는 먼저 로그인해 uid 를 받은 뒤 그 uid 로 사용자 문서를 심고 새로고침한다.

## 주의사항

**`affectedKeys()`는 값이 실제로 바뀐 필드만 반환합니다.**
이미 `approved: true` 인 계정이 `approved: true` 로 다시 쓰는 것은 변경으로 집계되지 않아 허용됩니다.
권한 상승이 아니므로 안전하며, 테스트를 작성할 때는 실제로 값이 바뀌는 시나리오를 써야 합니다.

**테스트 파일은 순차 실행해야 합니다.**
두 파일이 같은 에뮬레이터를 공유하므로 `--test-concurrency=1` 없이 병렬 실행하면
서로의 `clearFirestore()` 가 충돌해 엉뚱하게 실패합니다. (`package.json` 의 `test` 스크립트에 이미 반영돼 있습니다)
