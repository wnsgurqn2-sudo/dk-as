// 테스트 전용 firebase-config.js 대체본.
// 실제 운영 프로젝트가 아니라 로컬 에뮬레이터에 연결한다.
// (운영 데이터는 절대 건드리지 않는다)

const firebaseConfig = {
    apiKey: 'fake-api-key',
    authDomain: 'localhost',
    projectId: 'dk-as-rules-test',
    storageBucket: 'dk-as-rules-test.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:testtesttesttest'
};

const SUPER_ADMIN_EMAIL = 'wnsgurqn2@gmail.com';
const ROLE = { SUPER_ADMIN: 'superadmin', ADMIN: 'admin', USER: 'user' };
