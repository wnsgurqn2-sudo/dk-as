/*
 * ===== Firebase 설정 가이드 =====
 *
 * 1. https://console.firebase.google.com 접속
 * 2. "프로젝트 추가" 클릭 → 프로젝트 이름: "dk-as" → 생성
 * 3. 웹 앱 추가 (</> 아이콘) → 앱 이름: "DK AS" → 등록
 * 4. 아래 firebaseConfig에 표시된 값을 복사하여 붙여넣기
 *
 * === Authentication 설정 ===
 * 5. 좌측 메뉴 "Authentication" → "시작하기"
 * 6. "이메일/비밀번호" 제공업체 활성화
 * 7. "Settings" → "승인된 도메인"에 추가:
 *    - wnsgurqn2-sudo.github.io
 *
 * === Firestore 설정 ===
 * 8. 좌측 메뉴 "Firestore Database" → "데이터베이스 만들기"
 * 9. 위치: asia-northeast3 (서울) → "프로덕션 모드"로 시작
 * 10. "규칙" 탭에서 아래 보안 규칙 복사:
 *
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     // 로그인한 사용자만 접근
 *     match /products/{productId} {
 *       allow read, write: if request.auth != null;
 *     }
 *     match /history/{historyId} {
 *       allow read: if request.auth != null;
 *       allow write: if request.auth != null;
 *     }
 *     match /users/{userId} {
 *       allow read: if request.auth != null;
 *       allow write: if request.auth != null && (request.auth.uid == userId || request.auth.token.email == 'wnsgurqn2@gmail.com');
 *     }
 *   }
 * }
 *
 * === Storage 설정 ===
 * 11. 좌측 메뉴 "Storage" → "시작하기"
 * 12. "규칙" 탭에서 아래 보안 규칙 복사:
 *
 * rules_version = '2';
 * service firebase.storage {
 *   match /b/{bucket}/o {
 *     match /photos/{allPaths=**} {
 *       allow read: if request.auth != null;
 *       allow write: if request.auth != null
 *                     && request.resource.size < 5 * 1024 * 1024;
 *     }
 *   }
 * }
 */

const firebaseConfig = {
    apiKey: "AIzaSyAsLIn6sPehogVNwN2DAtjODo9ENuH7hQE",
    authDomain: "dk-as-b39cf.firebaseapp.com",
    projectId: "dk-as-b39cf",
    storageBucket: "dk-as-b39cf.firebasestorage.app",
    messagingSenderId: "124470106166",
    appId: "1:124470106166:web:e5f80a0ec7ffa0d93e2097"
};

// 총책임자 이메일
const SUPER_ADMIN_EMAIL = 'wnsgurqn2@gmail.com';
// 역할 상수
const ROLE = { SUPER_ADMIN: 'superadmin', ADMIN: 'admin', USER: 'user' };
