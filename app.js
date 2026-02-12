/**
 * DK AS - 임대제품 점검 시스템
 * 메인 JavaScript 파일 (v37 - Firebase 통합)
 */

// ===== 상수 정의 =====
const STATUS_TYPES = ['미점검', '수리대기', '수리중', '수리완료', '청소대기', '청소완료', '출고준비완료'];

// ===== Firebase 변수 =====
let db = null;
let authInstance = null;
let storageInstance = null;
let currentUser = null;
let currentUserProfile = null;
let isAdmin = false;

// ===== 시리얼넘버 생성 =====
function generateSerialNumber() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let sn = '';
    for (let i = 0; i < 8; i++) {
        sn += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // 중복 검사
    if (products.some(p => p.serialNumber === 'SN-' + sn)) {
        return generateSerialNumber();
    }
    return 'SN-' + sn;
}

// 상태별 진행률
const STATUS_PROGRESS = {
    '미점검': 0,
    '수리대기': 0,
    '수리중': 30,
    '수리완료': 50,
    '청소대기': 70,
    '청소완료': 90,
    '출고준비완료': 100,
    '예약': 100
};

// 진행률에 따른 색상 클래스
function getProgressColorClass(progress) {
    if (progress === 0) return 'progress-gray';
    if (progress <= 50) return 'progress-orange';
    if (progress <= 70) return 'progress-yellow';
    if (progress <= 90) return 'progress-lime';
    return 'progress-green';
}

// ===== 상태 관리 =====
let products = [];
let history = [];
let currentFilter = 'all';
let searchKeyword = '';
let html5QrCode = null;
let isScanning = false;
let currentScannedProduct = null;
let currentPhotoType = null; // 'rental' or 'return'
let rentalPhotos = []; // 임대 사진 배열
let returnPhotos = []; // 회수 사진 배열
const MAX_PHOTOS = 20; // 최대 사진 개수

// ===== Firebase 초기화 =====
function initFirebase() {
    try {
        if (typeof firebaseConfig === 'undefined' || firebaseConfig.apiKey === 'YOUR_API_KEY') {
            console.error('Firebase 설정이 필요합니다. firebase-config.js를 확인하세요.');
            return false;
        }
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        authInstance = firebase.auth();
        storageInstance = firebase.storage();
        return true;
    } catch (e) {
        console.error('Firebase 초기화 실패:', e);
        return false;
    }
}

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    if (!initFirebase()) {
        document.getElementById('loginOverlay').innerHTML = `
            <div class="login-container">
                <div class="login-header">
                    <h1>DK AS</h1>
                    <p>Firebase 설정이 필요합니다</p>
                </div>
                <p style="text-align:center;color:#666;margin-top:16px;">firebase-config.js 파일에 Firebase 설정값을 입력해주세요.</p>
            </div>`;
        return;
    }

    initAuth();
    initTabs();
    initProductForm();
    initBulkRegister();
    initFilters();
    initSearch();
    initQRGenerator();
    initModal();
    initEditProductModal();
    initRentalHistoryModal();
    initRepairHistoryModal();
    initPhotoCapture();
    initDeleteAll();
    initScanActions();
    initSettings();
    initUserManage();
});

// ===== 인증 관리 =====
function initAuth() {
    authInstance.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            try {
                const userDoc = await db.collection('users').doc(user.uid).get();
                if (userDoc.exists) {
                    currentUserProfile = userDoc.data();
                    isAdmin = user.email === ADMIN_EMAIL;

                    // 관리자는 항상 승인됨
                    if (isAdmin && !currentUserProfile.approved) {
                        await db.collection('users').doc(user.uid).update({ approved: true });
                        currentUserProfile.approved = true;
                    }

                    // 미승인 사용자 차단
                    if (!currentUserProfile.approved) {
                        showPendingApproval();
                        return;
                    }

                    hideLoginScreen();
                    hidePendingApproval();
                    updateHeaderUserInfo();
                    if (isAdmin) {
                        document.getElementById('adminHistoryTab').style.display = '';
                        document.getElementById('userManageItem').style.display = '';
                    }
                    await loadData();
                    updateDashboard();
                    updateProductList();
                    updateQRProductSelect();
                    updateQRSheetProductList();
                    updateNextProductId();
                    updateAutoCompleteSuggestions();
                } else {
                    // 프로필 미등록 (Google 로그인 최초) → 프로필 완성 폼 표시
                    showProfileCompleteForm();
                }
            } catch (e) {
                console.error('사용자 프로필 로드 오류:', e);
                showToast('사용자 정보를 불러오는 중 오류가 발생했습니다.', 'error');
            }
        } else {
            currentUser = null;
            currentUserProfile = null;
            isAdmin = false;
            products = [];
            history = [];
            showLoginScreen();
        }
    });

    // Google 로그인 버튼
    document.getElementById('googleLoginBtn').addEventListener('click', googleSignIn);

    // 프로필 완성 버튼
    document.getElementById('profileCompleteBtn').addEventListener('click', completeProfile);
    document.getElementById('profileDepartment').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') completeProfile();
    });
}

// Google 로그인
async function googleSignIn() {
    const btn = document.getElementById('googleLoginBtn');
    try {
        btn.disabled = true;
        const provider = new firebase.auth.GoogleAuthProvider();
        await authInstance.signInWithPopup(provider);
    } catch (e) {
        if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
            showToast('Google 로그인 실패: ' + e.message, 'error');
        }
    } finally {
        btn.disabled = false;
    }
}

// 프로필 완성 폼 표시
function showProfileCompleteForm() {
    const overlay = document.getElementById('loginOverlay');
    overlay.style.display = 'flex';
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('profileCompleteForm').style.display = 'block';
    // Google 계정에서 이름 가져오기
    if (currentUser && currentUser.displayName) {
        document.getElementById('profileName').value = currentUser.displayName;
    }
}

// 프로필 완성 처리
async function completeProfile() {
    const name = document.getElementById('profileName').value.trim();
    const department = document.getElementById('profileDepartment').value.trim();
    if (!name || !department) {
        showToast('이름과 부서를 입력해주세요.', 'error');
        return;
    }
    const btn = document.getElementById('profileCompleteBtn');
    try {
        btn.disabled = true;
        btn.textContent = '저장 중...';
        isAdmin = currentUser.email === ADMIN_EMAIL;
        const approved = isAdmin; // 관리자만 자동 승인
        currentUserProfile = { email: currentUser.email, name, department, approved };
        await db.collection('users').doc(currentUser.uid).set({
            ...currentUserProfile,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        if (!approved) {
            showPendingApproval();
            showToast('프로필이 등록되었습니다. 관리자 승인을 기다려주세요.', 'success');
        } else {
            hideLoginScreen();
            hidePendingApproval();
            updateHeaderUserInfo();
            document.getElementById('adminHistoryTab').style.display = '';
            document.getElementById('userManageItem').style.display = '';
            await loadData();
            updateDashboard();
            updateProductList();
            updateQRProductSelect();
            updateQRSheetProductList();
            updateNextProductId();
            updateAutoCompleteSuggestions();
            showToast('프로필이 등록되었습니다.', 'success');
        }
    } catch (e) {
        showToast('프로필 저장 실패: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '완료';
    }
}

function logoutUser() {
    authInstance.signOut();
    products = [];
    history = [];
}

function showLoginScreen() {
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('profileCompleteForm').style.display = 'none';
    hidePendingApproval();
}

function hideLoginScreen() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('profileCompleteForm').style.display = 'none';
}

function showPendingApproval() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('pendingApprovalOverlay').style.display = 'flex';
}

function hidePendingApproval() {
    document.getElementById('pendingApprovalOverlay').style.display = 'none';
}

// ===== 사용자 관리 (관리자 전용) =====
function initUserManage() {
    const modal = document.getElementById('userManageModal');
    document.getElementById('userManageBtn').addEventListener('click', () => {
        document.getElementById('settingsDropdown').classList.remove('show');
        modal.classList.add('show');
        loadUserList();
    });
    document.getElementById('userManageClose').addEventListener('click', () => modal.classList.remove('show'));
    document.getElementById('userManageBack').addEventListener('click', () => modal.classList.remove('show'));
    document.getElementById('pendingLogoutBtn').addEventListener('click', logoutUser);
}

async function loadUserList() {
    try {
        const snapshot = await db.collection('users').get();
        const pendingUsers = [];
        const approvedUsers = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            const user = { id: doc.id, ...data };
            // 관리자는 별도 표시하지 않음
            if (data.email === ADMIN_EMAIL) return;
            if (data.approved) {
                approvedUsers.push(user);
            } else {
                pendingUsers.push(user);
            }
        });

        renderPendingUsers(pendingUsers);
        renderApprovedUsers(approvedUsers);
    } catch (e) {
        console.error('사용자 목록 로드 실패:', e);
        showToast('사용자 목록을 불러오는 중 오류가 발생했습니다.', 'error');
    }
}

function renderPendingUsers(users) {
    const container = document.getElementById('pendingUserList');
    document.getElementById('pendingCount').textContent = users.length;
    if (users.length === 0) {
        container.innerHTML = '<div class="empty-state">대기 중인 사용자가 없습니다.</div>';
        return;
    }
    container.innerHTML = users.map(u => `
        <div class="user-manage-item">
            <div class="user-manage-info">
                <div class="user-manage-name">${u.department || ''} ${u.name || ''}</div>
                <div class="user-manage-email">${u.email || ''}</div>
            </div>
            <div class="user-manage-actions">
                <button class="btn-approve" onclick="approveUser('${u.id}')">승인</button>
                <button class="btn-reject" onclick="removeUser('${u.id}')">거부</button>
            </div>
        </div>
    `).join('');
}

function renderApprovedUsers(users) {
    const container = document.getElementById('approvedUserList');
    document.getElementById('approvedCount').textContent = users.length;
    if (users.length === 0) {
        container.innerHTML = '<div class="empty-state">승인된 사용자가 없습니다.</div>';
        return;
    }
    container.innerHTML = users.map(u => `
        <div class="user-manage-item">
            <div class="user-manage-info">
                <div class="user-manage-name">${u.department || ''} ${u.name || ''}</div>
                <div class="user-manage-email">${u.email || ''}</div>
            </div>
            <div class="user-manage-actions">
                <button class="btn-reject" onclick="removeUser('${u.id}')">제거</button>
            </div>
        </div>
    `).join('');
}

async function approveUser(userId) {
    try {
        await db.collection('users').doc(userId).update({ approved: true });
        showToast('사용자를 승인했습니다.', 'success');
        loadUserList();
    } catch (e) {
        showToast('승인 실패: ' + e.message, 'error');
    }
}

async function removeUser(userId) {
    if (!confirm('이 사용자를 제거하시겠습니까?')) return;
    try {
        await db.collection('users').doc(userId).delete();
        showToast('사용자를 제거했습니다.', 'success');
        loadUserList();
    } catch (e) {
        showToast('제거 실패: ' + e.message, 'error');
    }
}

function updateHeaderUserInfo() {
    if (currentUserProfile) {
        document.getElementById('headerUserInfo').style.display = 'block';
        document.getElementById('headerUserName').textContent =
            `${currentUserProfile.department} ${currentUserProfile.name}${isAdmin ? ' (관리자)' : ''}`;
        document.getElementById('settingsUserLabel').textContent =
            `${currentUserProfile.name} (${currentUserProfile.department})`;
    }
}

// ===== 임대기록 모달 =====
function initRentalHistoryModal() {
    const modal = document.getElementById('rentalHistoryModal');
    const closeBtn = document.getElementById('rentalHistoryClose');
    const backBtn = document.getElementById('rentalHistoryBack');

    closeBtn.addEventListener('click', closeRentalHistoryModal);
    backBtn.addEventListener('click', closeRentalHistoryModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeRentalHistoryModal();
        }
    });
}

// ===== 수리기록 모달 =====
function initRepairHistoryModal() {
    const modal = document.getElementById('repairHistoryModal');
    const closeBtn = document.getElementById('repairHistoryClose');
    const backBtn = document.getElementById('repairHistoryBack');

    closeBtn.addEventListener('click', closeRepairHistoryModal);
    backBtn.addEventListener('click', closeRepairHistoryModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeRepairHistoryModal();
        }
    });
}

function showRepairHistory(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const repairHistory = product.repairHistory || [];

    let historyHtml = '';
    if (repairHistory.length === 0) {
        historyHtml = '<div class="empty-state">수리 기록이 없습니다.</div>';
    } else {
        historyHtml = repairHistory.slice().reverse().map((record) => {
            const startDate = new Date(record.startDate).toLocaleDateString('ko-KR');
            const endDate = record.endDate ? new Date(record.endDate).toLocaleDateString('ko-KR') : '수리중';
            const note = record.note || '-';

            return `
                <div class="repair-history-item">
                    <div class="repair-history-header">
                        <span class="repair-status ${record.endDate ? 'completed' : 'in-progress'}">${record.endDate ? '완료' : '수리중'}</span>
                        <span class="repair-date">${startDate} ~ ${endDate}</span>
                    </div>
                    <div class="repair-history-details">
                        <span class="repair-note">${note}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('repairHistoryContent').innerHTML = historyHtml;
    document.getElementById('repairHistoryModal').classList.add('show');
}

function closeRepairHistoryModal() {
    document.getElementById('repairHistoryModal').classList.remove('show');
}

// ===== 사진 촬영 =====
function initPhotoCapture() {
    // 임대 - 카메라 버튼
    document.getElementById('rentalCameraBtn').addEventListener('click', () => {
        document.getElementById('rentalCameraInput').click();
    });

    // 임대 - 갤러리 버튼
    document.getElementById('rentalGalleryBtn').addEventListener('click', () => {
        document.getElementById('rentalGalleryInput').click();
    });

    // 임대 - 카메라 입력
    document.getElementById('rentalCameraInput').addEventListener('change', (e) => {
        handleMultiPhotoCapture(e, 'rental');
    });

    // 임대 - 갤러리 입력
    document.getElementById('rentalGalleryInput').addEventListener('change', (e) => {
        handleMultiPhotoCapture(e, 'rental');
    });

    // 회수 - 카메라 버튼
    document.getElementById('returnCameraBtn').addEventListener('click', () => {
        document.getElementById('returnCameraInput').click();
    });

    // 회수 - 갤러리 버튼
    document.getElementById('returnGalleryBtn').addEventListener('click', () => {
        document.getElementById('returnGalleryInput').click();
    });

    // 회수 - 카메라 입력
    document.getElementById('returnCameraInput').addEventListener('change', (e) => {
        handleMultiPhotoCapture(e, 'return');
    });

    // 회수 - 갤러리 입력
    document.getElementById('returnGalleryInput').addEventListener('change', (e) => {
        handleMultiPhotoCapture(e, 'return');
    });
}

function handleMultiPhotoCapture(event, type) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const photos = type === 'rental' ? rentalPhotos : returnPhotos;
    const remainingSlots = MAX_PHOTOS - photos.length;

    if (remainingSlots <= 0) {
        showToast(`최대 ${MAX_PHOTOS}장까지만 등록 가능합니다.`, 'error');
        event.target.value = '';
        return;
    }

    // 등록 가능한 개수만큼만 처리
    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    let processedCount = 0;

    filesToProcess.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            photos.push(e.target.result);
            processedCount++;

            // 모든 파일 처리 완료 시 UI 업데이트
            if (processedCount === filesToProcess.length) {
                updatePhotoList(type);
                event.target.value = ''; // 같은 파일 다시 선택 가능하도록

                if (files.length > remainingSlots) {
                    showToast(`${filesToProcess.length}장 등록됨 (최대 ${MAX_PHOTOS}장)`, 'success');
                }
            }
        };
        reader.readAsDataURL(file);
    });
}

function updatePhotoList(type) {
    const photos = type === 'rental' ? rentalPhotos : returnPhotos;
    const listId = type === 'rental' ? 'rentalPhotoList' : 'returnPhotoList';
    const countId = type === 'rental' ? 'rentalPhotoCount' : 'returnPhotoCount';

    document.getElementById(countId).textContent = photos.length;

    const listDiv = document.getElementById(listId);
    if (photos.length === 0) {
        listDiv.innerHTML = '';
        return;
    }

    listDiv.innerHTML = photos.map((photo, index) => `
        <div class="photo-item">
            <img src="${photo}" alt="사진 ${index + 1}">
            <button type="button" class="photo-delete-btn" onclick="deletePhoto('${type}', ${index})">×</button>
        </div>
    `).join('');
}

function deletePhoto(type, index) {
    const photos = type === 'rental' ? rentalPhotos : returnPhotos;
    photos.splice(index, 1);
    updatePhotoList(type);
}

function clearPhotos() {
    rentalPhotos = [];
    returnPhotos = [];
    updatePhotoList('rental');
    updatePhotoList('return');
}

// 전역 함수 노출
window.deletePhoto = deletePhoto;

// ===== 데이터 관리 (Firestore) =====
async function loadData() {
    try {
        // 제품 로드
        const productsSnapshot = await db.collection('products').get();
        products = [];
        productsSnapshot.forEach(doc => {
            products.push(doc.data());
        });

        // 생성일 기준 정렬
        products.sort((a, b) => {
            if (a.createdAt && b.createdAt) return a.createdAt.localeCompare(b.createdAt);
            return 0;
        });

        // 시리얼넘버 없는 제품에 자동 부여
        for (const p of products) {
            if (!p.serialNumber) {
                p.serialNumber = generateSerialNumber();
                await saveProduct(p);
            }
        }

        // 최근 히스토리 로드
        const historySnapshot = await db.collection('history')
            .orderBy('time', 'desc')
            .limit(100)
            .get();
        history = [];
        historySnapshot.forEach(doc => {
            history.push(doc.data());
        });
    } catch (e) {
        console.error('데이터 로드 오류:', e);
        showToast('데이터를 불러오는 중 오류가 발생했습니다.', 'error');
    }
}

async function saveProduct(product) {
    try {
        await db.collection('products').doc(product.id).set(product);
    } catch (e) {
        console.error('제품 저장 오류:', e);
    }
}

function saveData() {
    // 모든 제품을 Firestore에 일괄 저장 (비동기)
    const batch = db.batch();
    products.forEach(product => {
        batch.set(db.collection('products').doc(product.id), product);
    });
    batch.commit().catch(e => {
        console.error('데이터 저장 오류:', e);
        showToast('저장 중 오류가 발생했습니다.', 'error');
    });
}

async function deleteProductFromFirestore(productId) {
    try {
        await db.collection('products').doc(productId).delete();
    } catch (e) {
        console.error('제품 삭제 오류:', e);
    }
}

async function deleteAllProductsFromFirestore() {
    try {
        const snapshot = await db.collection('products').get();
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    } catch (e) {
        console.error('전체 삭제 오류:', e);
    }
}

// ===== Firebase Storage 사진 업로드 =====
async function uploadPhotosToStorage(photoBase64Array, productId, type) {
    if (!photoBase64Array || photoBase64Array.length === 0) return [];
    const urls = [];
    const timestamp = Date.now();
    for (let i = 0; i < photoBase64Array.length; i++) {
        try {
            const ref = storageInstance.ref(`photos/${productId}/${type}_${timestamp}_${i}`);
            await ref.putString(photoBase64Array[i], 'data_url');
            const url = await ref.getDownloadURL();
            urls.push(url);
        } catch (e) {
            console.error(`사진 업로드 오류 (${i}):`, e);
        }
    }
    return urls;
}

// ===== 탭 관리 =====
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tabId).classList.add('active');

            if (tabId === 'scan') {
                initQRScanner();
            } else {
                stopQRScanner();
            }

            if (tabId === 'dashboard') {
                updateDashboard();
            }

            if (tabId === 'admin-history' && isAdmin) {
                loadAdminHistory();
            }
        });
    });
}

// ===== QR 스캐너 =====
function initQRScanner() {
    if (html5QrCode || isScanning) return;

    html5QrCode = new Html5Qrcode("qr-reader");

    const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
    };

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        onQRCodeScanned,
        (errorMessage) => {}
    ).then(() => {
        isScanning = true;
    }).catch((err) => {
        console.error("카메라 시작 실패:", err);
        showToast('카메라를 시작할 수 없습니다.', 'error');
    });
}

function stopQRScanner() {
    if (html5QrCode && isScanning) {
        html5QrCode.stop().then(() => {
            html5QrCode = null;
            isScanning = false;
        }).catch(err => console.error("스캐너 중지 실패:", err));
    }
}

function onQRCodeScanned(decodedText) {
    // QR 형식: 제품ID만 (예: P001)
    const productId = decodedText.trim();

    const product = products.find(p => p.id === productId);

    if (!product) {
        showToast('등록되지 않은 제품입니다: ' + productId, 'error');
        return;
    }

    currentScannedProduct = product;
    showScanActionPanel(product);

    // 시리얼넘버 입력창 초기화
    document.getElementById('serialNumberInput').value = '';

    // 스캐너 일시 중지
    stopQRScanner();
}

// 시리얼넘버로 제품 검색
function searchBySerialNumber() {
    const input = document.getElementById('serialNumberInput').value.trim().toUpperCase();
    if (!input) {
        showToast('시리얼넘버를 입력해주세요.', 'error');
        return;
    }

    // SN- 접두사 없이 입력한 경우 자동 추가
    const sn = input.startsWith('SN-') ? input : 'SN-' + input;

    const product = products.find(p => p.serialNumber === sn);

    if (!product) {
        showToast('일치하는 제품이 없습니다: ' + sn, 'error');
        return;
    }

    currentScannedProduct = product;
    showScanActionPanel(product);
    document.getElementById('serialNumberInput').value = '';

    // 스캐너 일시 중지
    stopQRScanner();
}

function showScanActionPanel(product) {
    const panel = document.getElementById('scanActionPanel');
    const nameEl = document.getElementById('scannedProductName');
    const detailsEl = document.getElementById('scannedProductDetails');
    const rentalInfoEl = document.getElementById('scannedRentalInfo');

    nameEl.textContent = product.name;
    detailsEl.textContent = `${product.id} | ${product.category} | 잔여: ${product.remainingHours || product.totalHours}시간`;

    if (product.isRented && product.rentalCompany) {
        rentalInfoEl.textContent = `현재 임대중: ${product.rentalCompany}`;
        rentalInfoEl.style.display = 'block';
    } else {
        rentalInfoEl.style.display = 'none';
    }

    // 폼 초기화
    document.getElementById('actionButtons').style.display = 'flex';
    document.getElementById('rentalForm').style.display = 'none';
    document.getElementById('returnForm').style.display = 'none';
    document.getElementById('statusForm').style.display = 'none';

    panel.style.display = 'block';
}

function hideScanActionPanel() {
    try {
        // 패널 및 폼 숨기기 (최우선 실행)
        document.getElementById('scanActionPanel').style.display = 'none';
        document.getElementById('rentalForm').style.display = 'none';
        document.getElementById('returnForm').style.display = 'none';
        document.getElementById('statusForm').style.display = 'none';
        document.getElementById('actionButtons').style.display = 'flex';
    } catch (e) {
        console.error('패널 숨기기 오류:', e);
    }

    try {
        // 사진 초기화
        document.getElementById('rentalCameraInput').value = '';
        document.getElementById('rentalGalleryInput').value = '';
        document.getElementById('returnCameraInput').value = '';
        document.getElementById('returnGalleryInput').value = '';
        clearPhotos();

        // 입력 필드 초기화
        document.getElementById('rentalCompany').value = '';
        document.getElementById('returnHours').value = '';
        document.getElementById('returnNote').value = '';
        document.getElementById('statusNote').value = '';
        document.getElementById('usedTimeInfo').textContent = '';

        // 상태 버튼 선택 초기화
        document.querySelectorAll('#returnStatusButtons .status-btn').forEach(b => {
            b.classList.remove('selected');
        });
        document.querySelectorAll('#statusChangeButtons .status-btn').forEach(b => {
            b.classList.remove('selected');
        });
    } catch (e) {
        console.error('입력 초기화 오류:', e);
    }

    currentScannedProduct = null;

    // 해당 탭 초기화면(상단)으로 스크롤
    try {
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.scrollTop = 0;
        }
        window.scrollTo(0, 0);
    } catch (e) {
        console.error('스크롤 오류:', e);
    }

    // 스캐너 재시작 - 상태 강제 초기화 후 재시작
    try {
        restartQRScanner();
    } catch (e) {
        console.error('스캐너 재시작 오류:', e);
    }
}

function restartQRScanner() {
    try {
        // 기존 스캐너 정리
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                html5QrCode = null;
                isScanning = false;
                clearQRReaderAndRestart();
            }).catch(() => {
                html5QrCode = null;
                isScanning = false;
                clearQRReaderAndRestart();
            });
        } else {
            html5QrCode = null;
            isScanning = false;
            clearQRReaderAndRestart();
        }
    } catch (e) {
        console.error('스캐너 재시작 오류:', e);
        html5QrCode = null;
        isScanning = false;
        clearQRReaderAndRestart();
    }
}

function clearQRReaderAndRestart() {
    // QR 리더 DOM 요소 초기화
    const qrReader = document.getElementById('qr-reader');
    if (qrReader) {
        qrReader.innerHTML = '';
    }

    // 약간의 지연 후 스캐너 시작
    setTimeout(() => {
        initQRScanner();
    }, 500);
}

// ===== 스캔 액션 (임대/회수/상태변경) =====
function initScanActions() {
    // 시리얼넘버 엔터키 검색
    document.getElementById('serialNumberInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchBySerialNumber();
        }
    });

    // 임대 버튼
    document.getElementById('btnRental').addEventListener('click', () => {
        if (!currentScannedProduct) return;

        if (currentScannedProduct.isRented) {
            showToast('이미 임대중인 제품입니다.', 'error');
            return;
        }

        document.getElementById('actionButtons').style.display = 'none';
        document.getElementById('rentalForm').style.display = 'block';
        document.getElementById('rentalCompany').value = '';
        document.getElementById('rentalCompany').focus();
    });

    // 임대회수 버튼
    document.getElementById('btnReturn').addEventListener('click', () => {
        if (!currentScannedProduct) return;

        if (!currentScannedProduct.isRented) {
            showToast('임대중이 아닌 제품입니다.', 'error');
            return;
        }

        document.getElementById('actionButtons').style.display = 'none';
        document.getElementById('returnForm').style.display = 'block';
        document.getElementById('returnHours').value = '';
        document.getElementById('returnNote').value = '';

        const remaining = currentScannedProduct.remainingHours || currentScannedProduct.totalHours;
        document.getElementById('usedTimeInfo').textContent =
            `${currentScannedProduct.rentalCompany} 임대 | 회수 전 잔여시간: ${remaining}시간`;
    });

    // 상태변경 버튼
    document.getElementById('btnStatusChange').addEventListener('click', () => {
        if (!currentScannedProduct) return;

        document.getElementById('actionButtons').style.display = 'none';
        document.getElementById('statusForm').style.display = 'block';
        document.getElementById('statusNote').value = currentScannedProduct.lastNote || '';
    });

    // 임대 취소
    document.getElementById('btnRentalCancel').addEventListener('click', () => {
        hideScanActionPanel();
    });

    // 임대 저장
    document.getElementById('btnRentalSave').addEventListener('click', async () => {
        const company = document.getElementById('rentalCompany').value.trim();

        if (!company) {
            showToast('업체명을 입력해주세요.', 'error');
            return;
        }

        if (!currentScannedProduct) {
            showToast('스캔된 제품이 없습니다.', 'error');
            hideScanActionPanel();
            return;
        }

        const saveBtn = document.getElementById('btnRentalSave');
        try {
            saveBtn.disabled = true;
            saveBtn.textContent = '저장 중...';

            // 사진 업로드
            let photoUrls = [];
            if (rentalPhotos.length > 0) {
                photoUrls = await uploadPhotosToStorage(rentalPhotos, currentScannedProduct.id, 'rental');
            }

            // 제품 임대 처리
            const productIndex = products.findIndex(p => p.id === currentScannedProduct.id);
            if (productIndex !== -1) {
                const rentalRecord = {
                    type: '임대',
                    company: company,
                    rentalDate: new Date().toISOString(),
                    remainingHoursAtRental: products[productIndex].remainingHours || products[productIndex].totalHours,
                    photos: photoUrls
                };

                // 임대기록 배열 초기화 및 추가
                if (!products[productIndex].rentalHistory) {
                    products[productIndex].rentalHistory = [];
                }
                products[productIndex].rentalHistory.push(rentalRecord);

                products[productIndex].isRented = true;
                products[productIndex].rentalCompany = company;
                products[productIndex].rentalDate = new Date().toISOString();
                products[productIndex].currentRentalIndex = products[productIndex].rentalHistory.length - 1;
                saveData();

                // 기록 추가
                addHistory({
                    type: '임대',
                    productId: currentScannedProduct.id,
                    productName: currentScannedProduct.name,
                    company: company,
                    time: new Date().toISOString()
                });

                showToast(`${currentScannedProduct.name} - ${company} 임대 완료`, 'success');
                updateDashboard();
            }
        } catch (e) {
            console.error('임대 저장 오류:', e);
            showToast('저장 중 오류가 발생했습니다.', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '저장';
            hideScanActionPanel();
        }
    });

    // 임대회수 취소
    document.getElementById('btnReturnCancel').addEventListener('click', () => {
        hideScanActionPanel();
    });

    // 상태변경 취소
    document.getElementById('btnStatusCancel').addEventListener('click', () => {
        hideScanActionPanel();
    });

    // 회수 후 잔여시간 입력 시 실사용시간 계산 표시
    document.getElementById('returnHours').addEventListener('input', (e) => {
        const newRemaining = parseInt(e.target.value) || 0;
        const previousRemaining = currentScannedProduct.remainingHours || currentScannedProduct.totalHours;
        const usedHours = Math.abs(previousRemaining - newRemaining);

        document.getElementById('usedTimeInfo').innerHTML =
            `<strong>회수 전:</strong> ${previousRemaining}시간 → <strong>회수 후:</strong> ${newRemaining}시간<br>` +
            `<strong style="color: #dc2626;">실사용시간: ${usedHours}시간</strong> (${currentScannedProduct.rentalCompany})`;
    });

    // 임대회수 상태 버튼 클릭 (선택만)
    let selectedReturnStatus = null;
    document.querySelectorAll('#returnStatusButtons .status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // 기존 선택 해제
            document.querySelectorAll('#returnStatusButtons .status-btn').forEach(b => {
                b.classList.remove('selected');
            });
            // 현재 버튼 선택
            btn.classList.add('selected');
            selectedReturnStatus = btn.dataset.status;
        });
    });

    // 임대회수 저장 버튼
    document.getElementById('btnReturnSave').addEventListener('click', async () => {
        if (!selectedReturnStatus) {
            showToast('상태를 선택해주세요.', 'error');
            return;
        }

        if (!currentScannedProduct) {
            showToast('스캔된 제품이 없습니다.', 'error');
            hideScanActionPanel();
            return;
        }

        const saveBtn = document.getElementById('btnReturnSave');
        try {
            saveBtn.disabled = true;
            saveBtn.textContent = '저장 중...';

            const newRemaining = parseInt(document.getElementById('returnHours').value) || 0;
            const note = document.getElementById('returnNote').value.trim();

            // 사진 업로드
            let returnPhotoUrls = [];
            if (returnPhotos.length > 0) {
                returnPhotoUrls = await uploadPhotosToStorage(returnPhotos, currentScannedProduct.id, 'return');
            }

            // 제품 업데이트
            const productIndex = products.findIndex(p => p.id === currentScannedProduct.id);
            if (productIndex !== -1) {
                const previousRemaining = products[productIndex].remainingHours || products[productIndex].totalHours;
                const usedHours = Math.abs(previousRemaining - newRemaining);

                // 현재 임대 기록 업데이트
                if (products[productIndex].rentalHistory && products[productIndex].currentRentalIndex !== undefined) {
                    const currentRental = products[productIndex].rentalHistory[products[productIndex].currentRentalIndex];
                    if (currentRental) {
                        currentRental.returnDate = new Date().toISOString();
                        currentRental.usedHours = usedHours;
                        currentRental.remainingHoursAtReturn = newRemaining;
                        currentRental.note = note;
                        currentRental.returnPhotos = returnPhotoUrls;
                    }
                }

                const returnRecord = {
                    type: '임대회수',
                    productId: currentScannedProduct.id,
                    productName: currentScannedProduct.name,
                    company: products[productIndex].rentalCompany,
                    usedHours: usedHours,
                    previousRemaining: previousRemaining,
                    newRemaining: newRemaining,
                    note: note,
                    status: selectedReturnStatus,
                    time: new Date().toISOString()
                };

                products[productIndex].remainingHours = newRemaining;
                products[productIndex].isRented = false;
                products[productIndex].status = selectedReturnStatus;
                products[productIndex].lastUpdated = new Date().toISOString();
                products[productIndex].lastNote = note;
                products[productIndex].lastCompany = products[productIndex].rentalCompany;
                products[productIndex].lastUsedHours = usedHours;
                products[productIndex].rentalCompany = null;
                products[productIndex].rentalDate = null;
                products[productIndex].currentRentalIndex = null;

                saveData();
                addHistory(returnRecord);

                showToast(`${currentScannedProduct.name} 회수 완료 - 실사용: ${usedHours}h, ${selectedReturnStatus}`, 'success');
                updateDashboard();
            }
        } catch (e) {
            console.error('회수 저장 오류:', e);
            showToast('저장 중 오류가 발생했습니다.', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '저장';
            selectedReturnStatus = null;
            hideScanActionPanel();
        }
    });

    // 상태변경 버튼 클릭 (선택만)
    let selectedChangeStatus = null;
    document.querySelectorAll('#statusChangeButtons .status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#statusChangeButtons .status-btn').forEach(b => {
                b.classList.remove('selected');
            });
            btn.classList.add('selected');
            selectedChangeStatus = btn.dataset.status;
        });
    });

    // 상태변경 저장
    document.getElementById('btnStatusSave').addEventListener('click', () => {
        if (!selectedChangeStatus) {
            showToast('상태를 선택해주세요.', 'error');
            return;
        }

        if (!currentScannedProduct) {
            showToast('스캔된 제품이 없습니다.', 'error');
            hideScanActionPanel();
            return;
        }

        try {
            const note = document.getElementById('statusNote').value.trim();

            const productIndex = products.findIndex(p => p.id === currentScannedProduct.id);
            if (productIndex !== -1) {
                const previousStatus = products[productIndex].status;

                // 수리기록 처리
                if (!products[productIndex].repairHistory) {
                    products[productIndex].repairHistory = [];
                }
                if (selectedChangeStatus === '수리중' && previousStatus !== '수리중') {
                    products[productIndex].repairHistory.push({
                        startDate: new Date().toISOString(),
                        endDate: null,
                        note: note
                    });
                }
                if (previousStatus === '수리중' && selectedChangeStatus !== '수리중') {
                    const lastRepair = products[productIndex].repairHistory[products[productIndex].repairHistory.length - 1];
                    if (lastRepair && !lastRepair.endDate) {
                        lastRepair.endDate = new Date().toISOString();
                        lastRepair.endNote = note;
                    }
                }

                products[productIndex].status = selectedChangeStatus;
                products[productIndex].lastUpdated = new Date().toISOString();
                products[productIndex].lastNote = note;

                saveData();

                addHistory({
                    type: '상태변경',
                    productId: currentScannedProduct.id,
                    productName: currentScannedProduct.name,
                    previousStatus: previousStatus,
                    newStatus: selectedChangeStatus,
                    note: note,
                    time: new Date().toISOString()
                });

                showToast(`${currentScannedProduct.name} 상태 변경: ${selectedChangeStatus}`, 'success');
                updateDashboard();
            }
        } catch (e) {
            console.error('상태변경 저장 오류:', e);
            showToast('저장 중 오류가 발생했습니다.', 'error');
        } finally {
            selectedChangeStatus = null;
            hideScanActionPanel();
        }
    });
}

// ===== 기록 관리 =====
function addHistory(record) {
    // 사용자 정보 추가
    if (currentUser && currentUserProfile) {
        record.userId = currentUser.uid;
        record.userName = currentUserProfile.name;
        record.userDepartment = currentUserProfile.department;
        record.userEmail = currentUser.email;
    }

    history.unshift(record);
    if (history.length > 100) {
        history = history.slice(0, 100);
    }

    // Firestore에 히스토리 저장
    db.collection('history').add(record).catch(e => {
        console.error('히스토리 저장 오류:', e);
    });

    updateHistoryList();
}

function updateHistoryList() {
    const listDiv = document.getElementById('scanHistoryList');

    if (history.length === 0) {
        listDiv.innerHTML = '<div class="empty-state">기록이 없습니다.</div>';
        return;
    }

    listDiv.innerHTML = history.slice(0, 20).map(item => {
        const time = new Date(item.time);
        const timeStr = time.toLocaleString('ko-KR', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        let detail = '';
        let itemClass = '';
        if (item.type === '임대') {
            detail = `→ ${item.company}`;
            itemClass = 'rental';
        } else if (item.type === '임대회수') {
            detail = `← ${item.company} | ${item.previousRemaining}h→${item.newRemaining}h (실사용:${item.usedHours}h) | ${item.status}`;
            itemClass = 'return';
        } else if (item.type === '상태변경') {
            detail = `${item.previousStatus} → ${item.newStatus}`;
            itemClass = 'status-change';
        }

        return `
            <div class="history-item ${itemClass}">
                <span class="history-time">${timeStr}</span>
                <span class="history-type">${item.type}</span>
                <span class="history-product">${item.productName}</span>
                <span class="history-detail">${detail}</span>
            </div>
        `;
    }).join('');
}

// ===== 제품ID 자동 부여 =====
function getNextProductId() {
    let maxNum = 0;
    products.forEach(p => {
        const match = p.id.match(/^P(\d+)$/i);
        if (match) {
            const num = parseInt(match[1]);
            if (num > maxNum) maxNum = num;
        }
    });
    const nextNum = maxNum + 1;
    return 'P' + String(nextNum).padStart(3, '0');
}

function updateNextProductId() {
    const idInput = document.getElementById('productId');
    if (idInput && !idInput.value) {
        idInput.value = getNextProductId();
    }
}

// ===== 자동완성 제안 =====
function updateAutoCompleteSuggestions() {
    // 제품명 제안
    const nameSet = new Set(products.map(p => p.name));
    const nameDatalist = document.getElementById('productNameSuggestions');
    if (nameDatalist) {
        nameDatalist.innerHTML = Array.from(nameSet).map(name =>
            `<option value="${name}">`
        ).join('');
    }

    // 카테고리 제안
    const catSet = new Set(products.map(p => p.category).filter(c => c));
    const catDatalist = document.getElementById('productCategorySuggestions');
    if (catDatalist) {
        catDatalist.innerHTML = Array.from(catSet).map(cat =>
            `<option value="${cat}">`
        ).join('');
    }
}

// ===== 제품 관리 =====
function initProductForm() {
    const form = document.getElementById('productForm');

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const id = document.getElementById('productId').value.trim();
        const name = document.getElementById('productName').value.trim();
        const category = document.getElementById('productCategory').value.trim();
        const hours = parseInt(document.getElementById('productHours').value) || 0;
        const note = document.getElementById('productNote').value.trim();

        if (products.some(p => p.id === id)) {
            showToast('이미 등록된 제품 ID입니다.', 'error');
            return;
        }

        const product = {
            id,
            name,
            category: category || '기타',
            totalHours: hours,
            remainingHours: hours,
            note,
            status: '미점검',
            isRented: false,
            rentalCompany: null,
            rentalDate: null,
            serialNumber: generateSerialNumber(),
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        products.push(product);
        saveData();
        form.reset();

        // 제품등록 기록 추가
        addHistory({
            type: '제품등록',
            productId: product.id,
            productName: product.name,
            time: new Date().toISOString()
        });

        updateDashboard();
        updateProductList();
        updateQRProductSelect();
        updateQRSheetProductList();
        updateAutoCompleteSuggestions();

        // 제품ID 자동 부여
        document.getElementById('productId').value = getNextProductId();

        showToast('제품이 등록되었습니다.', 'success');
    });
}

function initBulkRegister() {
    const bulkBtn = document.getElementById('bulkRegisterBtn');

    bulkBtn.addEventListener('click', () => {
        const input = document.getElementById('bulkInput').value.trim();

        if (!input) {
            showToast('등록할 제품 정보를 입력해주세요.', 'error');
            return;
        }

        const lines = input.split('\n').filter(line => line.trim());
        let addedCount = 0;
        let skippedCount = 0;

        lines.forEach(line => {
            const parts = line.split(',').map(p => p.trim());

            if (parts.length < 4) {
                skippedCount++;
                return;
            }

            const id = parts[0];
            const name = parts[1];
            const category = parts[2] || '기타';
            const hours = parseInt(parts[3]) || 0;

            if (products.some(p => p.id === id)) {
                skippedCount++;
                return;
            }

            products.push({
                id,
                name,
                category,
                totalHours: hours,
                remainingHours: hours,
                note: '',
                status: '미점검',
                isRented: false,
                rentalCompany: null,
                rentalDate: null,
                serialNumber: generateSerialNumber(),
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            });

            addedCount++;
        });

        saveData();
        document.getElementById('bulkInput').value = '';

        updateDashboard();
        updateProductList();
        updateQRProductSelect();
        updateQRSheetProductList();

        showToast(`${addedCount}개 등록 완료 (${skippedCount}개 건너뜀)`, 'success');
    });
}

function initDeleteAll() {
    const deleteAllBtn = document.getElementById('deleteAllBtn');

    deleteAllBtn.addEventListener('click', () => {
        if (products.length === 0) {
            showToast('삭제할 제품이 없습니다.', 'error');
            return;
        }

        showModal(
            '전체 삭제',
            `등록된 ${products.length}개의 제품을 모두 삭제하시겠습니까?<br>이 작업은 되돌릴 수 없습니다.`,
            () => {
                const count = products.length;
                products = [];
                deleteAllProductsFromFirestore();

                addHistory({
                    type: '제품삭제',
                    productId: 'ALL',
                    productName: `전체 ${count}개 제품`,
                    time: new Date().toISOString()
                });

                updateDashboard();
                updateProductList();
                updateQRProductSelect();
                updateQRSheetProductList();

                showToast('모든 제품이 삭제되었습니다.', 'success');
            }
        );
    });
}

// ===== 설정 (크게보기 + 로그아웃) =====
function initSettings() {
    const settingsBtn = document.getElementById('settingsBtn');
    const dropdown = document.getElementById('settingsDropdown');
    const normalBtn = document.getElementById('viewNormalBtn');
    const largeBtn = document.getElementById('viewLargeBtn');

    // 저장된 설정 복원
    const savedView = localStorage.getItem('dk_as_view_mode');
    if (savedView === 'large') {
        document.body.classList.add('large-view');
        normalBtn.classList.remove('active');
        largeBtn.classList.add('active');
    }

    // 톱니 아이콘 클릭 - 드롭다운 토글
    settingsBtn.addEventListener('click', () => {
        dropdown.classList.toggle('show');
    });

    // 기본 버튼
    normalBtn.addEventListener('click', () => {
        document.body.classList.remove('large-view');
        normalBtn.classList.add('active');
        largeBtn.classList.remove('active');
        localStorage.setItem('dk_as_view_mode', 'normal');
    });

    // 크게보기 버튼
    largeBtn.addEventListener('click', () => {
        document.body.classList.add('large-view');
        largeBtn.classList.add('active');
        normalBtn.classList.remove('active');
        localStorage.setItem('dk_as_view_mode', 'large');
    });

    // 로그아웃 버튼
    document.getElementById('logoutBtn').addEventListener('click', () => {
        dropdown.classList.remove('show');
        logoutUser();
    });

    // 드롭다운 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!settingsBtn.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });
}

function updateProductList() {
    const listDiv = document.getElementById('productList');
    const countSpan = document.getElementById('productCount');

    countSpan.textContent = products.length;

    if (products.length === 0) {
        listDiv.innerHTML = '<div class="empty-state">등록된 제품이 없습니다.</div>';
        return;
    }

    listDiv.innerHTML = products.map(product => {
        // 임대/회수/예약 정보 생성
        let infoHtml = '';
        if (product.isRented) {
            const rentalDate = product.rentalDate ?
                new Date(product.rentalDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '';
            infoHtml = `
                <div class="rental-info-box">
                    <span class="rental-label">임대중</span>
                    <span class="rental-detail">${product.rentalCompany} | ${rentalDate}</span>
                </div>
            `;
        } else if (product.status === '예약' && product.reservedBy) {
            const reservedDate = product.reservedDate ?
                new Date(product.reservedDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '';
            infoHtml = `
                <div class="reserved-info-box">
                    <span class="reserved-label">예약</span>
                    <span class="reserved-detail">${product.reservedBy} | ${reservedDate}</span>
                </div>
            `;
        } else {
            const lastRentalRecord = product.rentalHistory && product.rentalHistory.length > 0 ?
                product.rentalHistory[product.rentalHistory.length - 1] : null;
            if (lastRentalRecord && lastRentalRecord.returnDate) {
                const returnDate = new Date(lastRentalRecord.returnDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
                infoHtml = `
                    <div class="return-info-box">
                        <span class="return-label">최근회수</span>
                        <span class="return-detail">${lastRentalRecord.company} | ${returnDate}</span>
                    </div>
                `;
            }
        }

        // 상태 배지
        let statusBadge = '';
        if (product.isRented) {
            statusBadge = `<span class="rental-badge">임대중</span>`;
        } else if (product.status === '예약') {
            statusBadge = `<span class="reserved-badge">예약</span>`;
        } else {
            statusBadge = `<span class="product-status ${product.status}">${product.status}</span>`;
        }

        return `
            <div class="product-item product-manage-item" data-id="${product.id}">
                <span class="product-status-badge ${product.isRented ? '임대중' : product.status}"></span>
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-id">${product.id} | ${product.category} | 잔여: ${product.remainingHours || product.totalHours}h</div>
                    ${infoHtml}
                </div>
                ${statusBadge}
                <div class="product-actions">
                    <button class="btn-icon danger delete-btn" data-id="${product.id}" title="삭제">🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    // 제품 항목 클릭 이벤트 (삭제 버튼 제외)
    listDiv.querySelectorAll('.product-manage-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // 삭제 버튼 클릭 시 모달 열지 않음
            if (e.target.closest('.delete-btn')) {
                return;
            }
            const productId = item.dataset.id;
            openEditProductModal(productId);
        });
    });

    // 삭제 버튼 이벤트
    listDiv.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteProduct(btn.dataset.id);
        });
    });
}

function deleteProduct(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    showModal(
        '제품 삭제',
        `"${product.name}" (${product.id})을(를) 삭제하시겠습니까?`,
        () => {
            products = products.filter(p => p.id !== productId);
            deleteProductFromFirestore(productId);

            // 제품삭제 기록 추가
            addHistory({
                type: '제품삭제',
                productId: product.id,
                productName: product.name,
                time: new Date().toISOString()
            });

            updateDashboard();
            updateProductList();
            updateQRProductSelect();
            updateQRSheetProductList();

            showToast('제품이 삭제되었습니다.', 'success');
        }
    );
}

// ===== 대시보드 =====
function initFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentFilter = btn.dataset.filter;
            updateDashboard();
        });
    });

    // 통계 카드 클릭으로 필터링
    document.querySelectorAll('.stat-card[data-filter]').forEach(card => {
        card.addEventListener('click', () => {
            const filter = card.dataset.filter;
            filterBtns.forEach(b => b.classList.remove('active'));

            const matchingBtn = document.querySelector(`.filter-btn[data-filter="${filter}"]`);
            if (matchingBtn) {
                matchingBtn.classList.add('active');
            }

            currentFilter = filter;
            updateDashboard();
        });
    });

    // 초기화 버튼
    document.getElementById('filterResetBtn').addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
        currentFilter = 'all';
        document.getElementById('dashboardSearch').value = '';
        searchKeyword = '';
        updateDashboard();
    });
}

function initSearch() {
    const searchInput = document.getElementById('dashboardSearch');

    searchInput.addEventListener('input', (e) => {
        searchKeyword = e.target.value.trim().toLowerCase();
        updateDashboard();
    });
}

function updateDashboard() {
    // 통계 계산 (임대중 + 7개 상태)
    const total = products.length;
    const rented = products.filter(p => p.isRented).length;
    const unchecked = products.filter(p => !p.isRented && p.status === '미점검').length;
    const repairWait = products.filter(p => !p.isRented && p.status === '수리대기').length;
    const repairing = products.filter(p => !p.isRented && p.status === '수리중').length;
    const repairDone = products.filter(p => !p.isRented && p.status === '수리완료').length;
    const cleanWait = products.filter(p => !p.isRented && p.status === '청소대기').length;
    const cleanDone = products.filter(p => !p.isRented && p.status === '청소완료').length;
    const ready = products.filter(p => !p.isRented && p.status === '출고준비완료').length;
    const reserved = products.filter(p => !p.isRented && p.status === '예약').length;

    // 통계 카드 업데이트
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statRented').textContent = rented;
    document.getElementById('statUnchecked').textContent = unchecked;
    document.getElementById('statRepairWait').textContent = repairWait;
    document.getElementById('statRepairing').textContent = repairing;
    document.getElementById('statRepairDone').textContent = repairDone;
    document.getElementById('statCleanWait').textContent = cleanWait;
    document.getElementById('statCleanDone').textContent = cleanDone;
    document.getElementById('statReady').textContent = ready;
    document.getElementById('statReserved').textContent = reserved;

    // 필터 버튼 개수 업데이트
    document.getElementById('filterCountAll').textContent = total;
    document.getElementById('filterCountRented').textContent = rented;
    document.getElementById('filterCountUnchecked').textContent = unchecked;
    document.getElementById('filterCountRepairWait').textContent = repairWait;
    document.getElementById('filterCountRepairing').textContent = repairing;
    document.getElementById('filterCountRepairDone').textContent = repairDone;
    document.getElementById('filterCountCleanWait').textContent = cleanWait;
    document.getElementById('filterCountCleanDone').textContent = cleanDone;
    document.getElementById('filterCountReady').textContent = ready;
    document.getElementById('filterCountReserved').textContent = reserved;

    // 진행률 (각 항목별 가중치 적용)
    let totalProgress = 0;
    products.forEach(p => {
        totalProgress += STATUS_PROGRESS[p.status] || 0;
    });
    const progressPercent = total > 0 ? Math.round(totalProgress / total) : 0;

    document.getElementById('progressPercent').textContent = progressPercent + '%';
    document.getElementById('progressFill').style.width = progressPercent + '%';

    // 최종 업데이트 시간
    document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('ko-KR');

    // 목록 업데이트
    updateDashboardList();
    updateHistoryList();
}

function updateDashboardList() {
    const listDiv = document.getElementById('dashboardList');

    let filteredProducts = products;

    // 검색 키워드가 있으면 전체 기준으로 검색 (필터 무시)
    if (searchKeyword) {
        filteredProducts = products.filter(p =>
            p.name.toLowerCase().includes(searchKeyword) ||
            p.id.toLowerCase().includes(searchKeyword) ||
            (p.rentalCompany && p.rentalCompany.toLowerCase().includes(searchKeyword)) ||
            (p.lastCompany && p.lastCompany.toLowerCase().includes(searchKeyword)) ||
            (p.reservedBy && p.reservedBy.toLowerCase().includes(searchKeyword))
        );
    } else if (currentFilter !== 'all') {
        if (currentFilter === '임대중') {
            filteredProducts = filteredProducts.filter(p => p.isRented);
        } else {
            filteredProducts = filteredProducts.filter(p => !p.isRented && p.status === currentFilter);
        }
    }

    if (filteredProducts.length === 0) {
        listDiv.innerHTML = `<div class="empty-state">
            ${searchKeyword ? '검색 결과가 없습니다.' : (currentFilter === 'all' ? '등록된 제품이 없습니다.' : '해당하는 제품이 없습니다.')}
        </div>`;
        return;
    }

    listDiv.innerHTML = filteredProducts.map(product => {
        const itemProgress = STATUS_PROGRESS[product.status] || 0;
        const progressClass = getProgressColorClass(itemProgress);

        // 임대중인 제품: 임대중 + 업체명 + 임대일자 표시
        let statusHtml = '';
        let infoHtml = '';

        if (product.isRented) {
            const rentalDate = product.rentalDate ?
                new Date(product.rentalDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '';
            infoHtml = `
                <div class="rental-info-box">
                    <span class="rental-label">임대중</span>
                    <span class="rental-detail">${product.rentalCompany} | ${rentalDate}</span>
                </div>
            `;
            statusHtml = `<span class="rental-badge">임대중</span>`;
        } else if (product.status === '예약' && product.reservedBy) {
            const reservedDate = product.reservedDate ?
                new Date(product.reservedDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '';
            infoHtml = `
                <div class="reserved-info-box">
                    <span class="reserved-label">예약</span>
                    <span class="reserved-detail">${product.reservedBy} | ${reservedDate}</span>
                </div>
            `;
            statusHtml = `<span class="reserved-badge">예약</span>`;
        } else {
            // 회수된 제품: 최근 회수일자 + 업체명 표시
            const lastRentalRecord = product.rentalHistory && product.rentalHistory.length > 0 ?
                product.rentalHistory[product.rentalHistory.length - 1] : null;

            if (lastRentalRecord && lastRentalRecord.returnDate) {
                const returnDate = new Date(lastRentalRecord.returnDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
                infoHtml = `
                    <div class="return-info-box">
                        <span class="return-label">최근회수</span>
                        <span class="return-detail">${lastRentalRecord.company} | ${returnDate}</span>
                    </div>
                `;
            }
            statusHtml = `<span class="product-status ${product.status}">${product.status}</span>`;
        }

        return `
            <div class="product-item dashboard-item" data-id="${product.id}">
                <span class="product-status-badge ${product.isRented ? '임대중' : product.status}"></span>
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-id">${product.id} | 잔여: ${product.remainingHours || product.totalHours}h</div>
                    ${infoHtml}
                    ${product.lastNote ? `<div class="product-note">메모: ${product.lastNote}</div>` : ''}
                    <div class="item-progress-section">
                        <div class="item-progress-bar">
                            <div class="item-progress-fill ${progressClass}" style="width: ${itemProgress}%"></div>
                        </div>
                        <span class="item-progress-text">${itemProgress}%</span>
                    </div>
                </div>
                ${statusHtml}
            </div>
        `;
    }).join('');

    // 대시보드 항목 클릭 이벤트 추가
    listDiv.querySelectorAll('.dashboard-item').forEach(item => {
        item.addEventListener('click', () => {
            const productId = item.dataset.id;
            openEditProductModal(productId);
        });
    });
}

// ===== QR 코드 생성 (제품정보 모달용) =====
function initQRGenerator() {
    // QR생성 탭이 삭제됨 - 제품정보 모달에서 QR 생성은 계속 지원
}

function updateQRProductSelect() {
    // QR생성 탭 삭제로 더 이상 사용하지 않음
}

function updateQRSheetProductList() {
    // QR생성 탭 삭제로 더 이상 사용하지 않음
}

// ===== 유틸리티 =====
function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;

    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

function initModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    const modalClose = document.getElementById('modalClose');
    const modalCancel = document.getElementById('modalCancel');

    modalClose.addEventListener('click', hideModal);
    modalCancel.addEventListener('click', hideModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            hideModal();
        }
    });
}

let modalConfirmCallback = null;

function showModal(title, body, onConfirm) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = body;
    document.getElementById('modalOverlay').classList.add('show');

    modalConfirmCallback = onConfirm;

    document.getElementById('modalConfirm').onclick = () => {
        if (modalConfirmCallback) {
            modalConfirmCallback();
        }
        hideModal();
    };
}

function hideModal() {
    document.getElementById('modalOverlay').classList.remove('show');
    modalConfirmCallback = null;
}

// ===== 제품 편집 모달 =====
let currentEditProduct = null;

function initEditProductModal() {
    const modal = document.getElementById('editProductModal');
    const closeBtn = document.getElementById('editModalClose');
    const cancelBtn = document.getElementById('editModalCancel');
    const saveBtn = document.getElementById('editModalSave');
    const downloadBtn = document.getElementById('editQrDownload');
    const historyBtn = document.getElementById('editHistoryBtn');
    const repairHistoryBtn = document.getElementById('editRepairHistoryBtn');

    closeBtn.addEventListener('click', closeEditProductModal);
    cancelBtn.addEventListener('click', closeEditProductModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeEditProductModal();
        }
    });

    // QR 다운로드 버튼 (시리얼넘버 포함)
    downloadBtn.addEventListener('click', () => {
        if (!currentEditProduct) return;

        const qrContainer = document.getElementById('editQrCode');
        const qrCanvas = qrContainer.querySelector('canvas');
        const qrImg = qrContainer.querySelector('img');
        const sn = currentEditProduct.serialNumber || '';

        // QR 이미지 소스 확보
        let qrSource = null;
        if (qrCanvas) {
            qrSource = qrCanvas;
        } else if (qrImg) {
            qrSource = qrImg;
        }

        if (!qrSource) return;

        // 시리얼넘버 포함 캔버스 생성
        const padding = 20;
        const snHeight = 30;
        const qrSize = 120;
        const totalWidth = qrSize + padding * 2;
        const totalHeight = qrSize + padding * 2 + snHeight;

        const dlCanvas = document.createElement('canvas');
        dlCanvas.width = totalWidth;
        dlCanvas.height = totalHeight;
        const ctx = dlCanvas.getContext('2d');

        // 흰색 배경
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, totalWidth, totalHeight);

        // QR 코드 그리기
        ctx.drawImage(qrSource, padding, padding, qrSize, qrSize);

        // 시리얼넘버 텍스트
        if (sn) {
            ctx.fillStyle = '#374151';
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(sn, totalWidth / 2, qrSize + padding + snHeight - 6);
        }

        const link = document.createElement('a');
        link.download = `QR_${currentEditProduct.id}.png`;
        link.href = dlCanvas.toDataURL('image/png');
        link.click();
        showToast('QR코드가 다운로드되었습니다.', 'success');
    });

    // 기록 버튼 - 임대 기록 표시
    historyBtn.addEventListener('click', () => {
        if (!currentEditProduct) return;
        showRentalHistory(currentEditProduct.id);
    });

    // 수리기록 버튼
    repairHistoryBtn.addEventListener('click', () => {
        if (!currentEditProduct) return;
        showRepairHistory(currentEditProduct.id);
    });

    // 상태 변경 시 예약 담당자 입력 표시/숨김
    document.getElementById('editProductStatus').addEventListener('change', (e) => {
        const reservedByGroup = document.getElementById('reservedByGroup');
        if (e.target.value === '예약') {
            reservedByGroup.style.display = 'block';
            document.getElementById('editReservedBy').focus();
        } else {
            reservedByGroup.style.display = 'none';
            document.getElementById('editReservedBy').value = '';
        }
    });

    saveBtn.addEventListener('click', () => {
        if (!currentEditProduct) return;

        // 임대중인 경우 저장하지 않음
        if (currentEditProduct.isRented) {
            showToast('임대중인 제품은 상태를 변경할 수 없습니다.', 'error');
            return;
        }

        const newStatus = document.getElementById('editProductStatus').value;
        const newNote = document.getElementById('editProductNote').value.trim();

        // 예약 시 담당자 이름 필수
        if (newStatus === '예약') {
            const reservedBy = document.getElementById('editReservedBy').value.trim();
            if (!reservedBy) {
                showToast('담당자 이름을 입력해주세요.', 'error');
                return;
            }
        }

        const productIndex = products.findIndex(p => p.id === currentEditProduct.id);
        if (productIndex !== -1) {
            const previousStatus = products[productIndex].status;

            // 수리기록 처리
            if (!products[productIndex].repairHistory) {
                products[productIndex].repairHistory = [];
            }

            // 수리중으로 변경 시 수리 시작 기록
            if (newStatus === '수리중' && previousStatus !== '수리중') {
                products[productIndex].repairHistory.push({
                    startDate: new Date().toISOString(),
                    endDate: null,
                    note: newNote
                });
            }

            // 수리중에서 다른 상태로 변경 시 수리 완료 기록
            if (previousStatus === '수리중' && newStatus !== '수리중') {
                const lastRepair = products[productIndex].repairHistory[products[productIndex].repairHistory.length - 1];
                if (lastRepair && !lastRepair.endDate) {
                    lastRepair.endDate = new Date().toISOString();
                    lastRepair.endNote = newNote;
                }
            }

            products[productIndex].status = newStatus;
            products[productIndex].lastNote = newNote;
            products[productIndex].lastUpdated = new Date().toISOString();

            // 예약 정보 처리
            if (newStatus === '예약') {
                products[productIndex].isReserved = true;
                products[productIndex].reservedBy = document.getElementById('editReservedBy').value.trim();
                products[productIndex].reservedDate = new Date().toISOString();
            } else {
                products[productIndex].isReserved = false;
                products[productIndex].reservedBy = null;
                products[productIndex].reservedDate = null;
            }

            saveData();

            // 상태가 변경된 경우에만 기록 추가
            if (previousStatus !== newStatus) {
                addHistory({
                    type: '상태변경',
                    productId: currentEditProduct.id,
                    productName: currentEditProduct.name,
                    previousStatus: previousStatus,
                    newStatus: newStatus,
                    note: newNote,
                    time: new Date().toISOString()
                });
            }

            showToast(`${currentEditProduct.name} 정보가 수정되었습니다.`, 'success');
        }

        // 모달 닫기 먼저 실행
        closeEditProductModal();

        // UI 업데이트
        updateDashboard();
        updateProductList();

        // 해당 탭 초기화면(상단)으로 스크롤
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.scrollTop = 0;
        }
        window.scrollTo(0, 0);
    });
}

// 임대 기록 표시
function showRentalHistory(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const rentalHistory = product.rentalHistory || [];

    let historyHtml = '';
    if (rentalHistory.length === 0) {
        historyHtml = '<div class="empty-state">임대 기록이 없습니다.</div>';
    } else {
        historyHtml = rentalHistory.slice().reverse().map((record, index) => {
            const actualIndex = rentalHistory.length - 1 - index;
            const rentalDate = new Date(record.rentalDate).toLocaleDateString('ko-KR');
            const returnDate = record.returnDate ? new Date(record.returnDate).toLocaleDateString('ko-KR') : '임대중';
            const usedHours = record.usedHours !== undefined ? `${record.usedHours}시간` : '-';
            const note = record.note || '-';

            // 임대 전 사진 (photos 또는 photo 호환)
            let rentalPhotosHtml = '';
            const rentalPhotos = record.photos || (record.photo ? [record.photo] : []);
            if (rentalPhotos.length > 0) {
                rentalPhotosHtml = `
                    <div class="history-photos-section">
                        <p class="photos-label">임대 전 사진 (${rentalPhotos.length}장)</p>
                        <div class="history-photos">
                            ${rentalPhotos.map((p, i) => `<img src="${p}" alt="임대 전 ${i+1}" onclick="showPhotoModal('${p}')">`).join('')}
                        </div>
                    </div>
                `;
            }

            // 회수 후 사진 (returnPhotos 또는 returnPhoto 호환)
            let returnPhotosHtml = '';
            const returnPhotos = record.returnPhotos || (record.returnPhoto ? [record.returnPhoto] : []);
            if (returnPhotos.length > 0) {
                returnPhotosHtml = `
                    <div class="history-photos-section">
                        <p class="photos-label">회수 후 사진 (${returnPhotos.length}장)</p>
                        <div class="history-photos">
                            ${returnPhotos.map((p, i) => `<img src="${p}" alt="회수 후 ${i+1}" onclick="showPhotoModal('${p}')">`).join('')}
                        </div>
                    </div>
                `;
            }

            return `
                <div class="rental-history-item" data-index="${actualIndex}" data-product-id="${productId}">
                    <div class="rental-history-header">
                        <span class="rental-company">${record.company}</span>
                        <span class="rental-date">${rentalDate} ~ ${returnDate}</span>
                    </div>
                    <div class="rental-history-details">
                        <span>사용시간: ${usedHours}</span>
                        <span class="history-note">비고: <span class="note-text">${note}</span></span>
                    </div>
                    ${rentalPhotosHtml}
                    ${returnPhotosHtml}
                </div>
            `;
        }).join('');
    }

    document.getElementById('rentalHistoryContent').innerHTML = historyHtml;
    document.getElementById('rentalHistoryModal').classList.add('show');

    // 임대기록 삭제 이벤트 바인딩 (모바일 롱프레스 / PC 우클릭)
    initRentalHistoryDeleteEvents();
}

function initRentalHistoryDeleteEvents() {
    const items = document.querySelectorAll('#rentalHistoryContent .rental-history-item');
    items.forEach(item => {
        let longPressTimer;

        // 모바일 롱프레스
        item.addEventListener('touchstart', () => {
            longPressTimer = setTimeout(() => {
                showRentalDeleteBtn(item);
            }, 600);
        }, { passive: true });
        item.addEventListener('touchend', () => clearTimeout(longPressTimer));
        item.addEventListener('touchmove', () => clearTimeout(longPressTimer));

        // PC 우클릭
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showRentalDeleteBtn(item);
        });
    });
}

function showRentalDeleteBtn(item) {
    // 기존 삭제 버튼 제거
    document.querySelectorAll('.rental-history-delete-btn').forEach(btn => btn.remove());

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'rental-history-delete-btn';
    deleteBtn.textContent = '삭제';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = item.dataset.productId;
        const idx = parseInt(item.dataset.index);
        deleteRentalRecord(pid, idx);
    });
    item.style.position = 'relative';
    item.appendChild(deleteBtn);
}

function deleteRentalRecord(productId, index) {
    // 임대기록 모달을 먼저 닫아서 확인 모달이 보이도록 처리
    closeRentalHistoryModal();

    showModal('임대기록 삭제', '이 임대기록을 삭제하시겠습니까?', () => {
        const product = products.find(p => p.id === productId);
        if (product && product.rentalHistory && product.rentalHistory[index]) {
            product.rentalHistory.splice(index, 1);
            saveData();
            // 삭제 후 임대기록 모달 다시 열기
            showRentalHistory(productId);
            updateDashboard();
            updateProductList();
            showToast('임대기록이 삭제되었습니다.', 'success');
        }
    });
}

// 사진 확대 모달
function showPhotoModal(src) {
    const overlay = document.createElement('div');
    overlay.className = 'photo-modal-overlay';
    overlay.innerHTML = `
        <div class="photo-modal-content">
            <img src="${src}" alt="확대 사진">
            <button class="photo-modal-close">×</button>
        </div>
    `;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.classList.contains('photo-modal-close')) {
            overlay.remove();
        }
    });
    document.body.appendChild(overlay);
}

window.showPhotoModal = showPhotoModal;

function closeRentalHistoryModal() {
    document.getElementById('rentalHistoryModal').classList.remove('show');
}

function openEditProductModal(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    currentEditProduct = product;

    document.getElementById('editProductName').textContent = product.name;
    document.getElementById('editProductDetails').textContent =
        `${product.id} | 잔여: ${product.remainingHours || product.totalHours}h`;

    const statusSelect = document.getElementById('editProductStatus');
    const statusFormGroup = statusSelect.closest('.form-group');

    // 임대중인 경우 상태변경 비활성화
    if (product.isRented) {
        statusSelect.disabled = true;
        statusSelect.innerHTML = '<option value="임대중">임대중</option>';
        statusSelect.value = '임대중';
        statusFormGroup.classList.add('disabled');
    } else {
        statusSelect.disabled = false;
        statusSelect.innerHTML = `
            <option value="미점검">미점검</option>
            <option value="수리대기">수리대기</option>
            <option value="수리중">수리중</option>
            <option value="수리완료">수리완료</option>
            <option value="청소대기">청소대기</option>
            <option value="청소완료">청소완료</option>
            <option value="출고준비완료">출고준비완료</option>
            <option value="예약" style="color: #2563eb; font-weight: 700;">예약</option>
        `;
        statusSelect.value = product.status;
        statusFormGroup.classList.remove('disabled');
    }

    // 예약 담당자 필드 처리
    const reservedByGroup = document.getElementById('reservedByGroup');
    if (product.status === '예약' && product.reservedBy) {
        reservedByGroup.style.display = 'block';
        document.getElementById('editReservedBy').value = product.reservedBy;
    } else {
        reservedByGroup.style.display = 'none';
        document.getElementById('editReservedBy').value = '';
    }

    document.getElementById('editProductNote').value = product.lastNote || '';

    // QR코드 생성
    generateEditModalQR(productId);

    document.getElementById('editProductModal').classList.add('show');
}

function generateEditModalQR(productId) {
    const qrContainer = document.getElementById('editQrCode');
    qrContainer.innerHTML = '';

    if (typeof QRCode === 'undefined') {
        qrContainer.innerHTML = '<p style="color: #999; font-size: 12px;">QR 로딩 중...</p>';
        return;
    }

    try {
        new QRCode(qrContainer, {
            text: productId,
            width: 120,
            height: 120,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });

        // QR 하단에 시리얼넘버 표시
        const product = products.find(p => p.id === productId);
        if (product && product.serialNumber) {
            const snLabel = document.createElement('div');
            snLabel.className = 'qr-serial-number';
            snLabel.textContent = product.serialNumber;
            qrContainer.appendChild(snLabel);
        }
    } catch (e) {
        console.error('QR 생성 오류:', e);
    }
}

function closeEditProductModal() {
    document.getElementById('editProductModal').classList.remove('show');
    currentEditProduct = null;
}

// ===== 관리자 히스토리 =====
let adminHistoryLastDoc = null;
let adminHistoryData = [];
const ADMIN_HISTORY_PAGE_SIZE = 30;

async function loadAdminHistory(reset = true) {
    if (!isAdmin) return;

    try {
        if (reset) {
            adminHistoryLastDoc = null;
            adminHistoryData = [];
        }

        // 단순 쿼리 (orderBy만) - 복합 인덱스 불필요
        let query = db.collection('history').orderBy('time', 'desc');

        if (adminHistoryLastDoc) {
            query = query.startAfter(adminHistoryLastDoc);
        }

        query = query.limit(ADMIN_HISTORY_PAGE_SIZE * 3);

        const snapshot = await query.get();

        if (snapshot.empty && reset) {
            document.getElementById('adminHistoryList').innerHTML =
                '<div class="empty-state">히스토리가 없습니다.</div>';
            document.getElementById('adminHistoryLoadMore').style.display = 'none';
            return;
        }

        if (!snapshot.empty) {
            adminHistoryLastDoc = snapshot.docs[snapshot.docs.length - 1];
        }

        // 클라이언트 사이드 필터링
        const userFilter = document.getElementById('adminHistoryUserFilter').value;
        const typeFilter = document.getElementById('adminHistoryTypeFilter').value;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (userFilter !== 'all' && data.userId !== userFilter) return;
            if (typeFilter !== 'all' && data.type !== typeFilter) return;
            adminHistoryData.push(data);
        });

        // 더보기 버튼 표시/숨김
        document.getElementById('adminHistoryLoadMore').style.display =
            snapshot.size >= ADMIN_HISTORY_PAGE_SIZE * 3 ? 'block' : 'none';

        renderAdminHistory();

        // 사용자 필터 옵션 업데이트
        if (reset) {
            loadAdminHistoryUsers();
        }
    } catch (e) {
        console.error('관리자 히스토리 로드 오류:', e);
        document.getElementById('adminHistoryList').innerHTML =
            '<div class="empty-state">히스토리를 불러오는 중 오류가 발생했습니다.</div>';
    }
}

function renderAdminHistory() {
    const listDiv = document.getElementById('adminHistoryList');

    if (adminHistoryData.length === 0) {
        listDiv.innerHTML = '<div class="empty-state">히스토리가 없습니다.</div>';
        return;
    }

    listDiv.innerHTML = adminHistoryData.map(item => {
        const time = new Date(item.time);
        const timeStr = time.toLocaleString('ko-KR', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // 유형별 배지 클래스
        let badgeClass = 'type-status';
        if (item.type === '임대') badgeClass = 'type-rental';
        else if (item.type === '임대회수') badgeClass = 'type-return';
        else if (item.type === '상태변경') badgeClass = 'type-status';
        else if (item.type === '제품등록') badgeClass = 'type-register';
        else if (item.type === '제품삭제') badgeClass = 'type-delete';

        // 상세 정보
        let detail = '';
        if (item.type === '임대') {
            detail = `→ ${item.company}`;
        } else if (item.type === '임대회수') {
            detail = `← ${item.company || ''} | ${item.previousRemaining || 0}h→${item.newRemaining || 0}h | ${item.status || ''}`;
        } else if (item.type === '상태변경') {
            detail = `${item.previousStatus || ''} → ${item.newStatus || ''}`;
        } else if (item.type === '제품등록' || item.type === '제품삭제') {
            detail = item.productName || '';
        }

        const userName = item.userName || '알 수 없음';
        const userDept = item.userDepartment || '';

        return `
            <div class="admin-history-item">
                <div class="history-user">${userDept} ${userName}</div>
                <div class="history-action">
                    <span class="history-type-badge ${badgeClass}">${item.type}</span>
                    ${item.productName || ''} ${detail}
                </div>
                <div class="history-time">${timeStr}</div>
            </div>
        `;
    }).join('');
}

async function loadAdminHistoryUsers() {
    try {
        const usersSnapshot = await db.collection('users').get();
        const select = document.getElementById('adminHistoryUserFilter');
        const currentValue = select.value;

        // 기존 옵션 유지 (첫 번째 "전체 사용자" 옵션)
        select.innerHTML = '<option value="all">전체 사용자</option>';

        usersSnapshot.forEach(doc => {
            const user = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = `${user.department || ''} ${user.name || user.email}`;
            select.appendChild(option);
        });

        select.value = currentValue || 'all';
    } catch (e) {
        console.error('사용자 목록 로드 오류:', e);
    }
}

// 관리자 히스토리 필터 이벤트
document.addEventListener('DOMContentLoaded', () => {
    const userFilter = document.getElementById('adminHistoryUserFilter');
    const typeFilter = document.getElementById('adminHistoryTypeFilter');
    const loadMoreBtn = document.getElementById('adminHistoryLoadMore');

    if (userFilter) {
        userFilter.addEventListener('change', () => loadAdminHistory(true));
    }
    if (typeFilter) {
        typeFilter.addEventListener('change', () => loadAdminHistory(true));
    }
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => loadAdminHistory(false));
    }
});

// 전역 함수로 노출
window.deleteProduct = deleteProduct;

// ===== 테스트 데이터 생성 (관리자 전용) =====
async function generateTestData() {
    if (!isAdmin) { showToast('관리자만 사용 가능합니다.', 'error'); return; }
    if (!confirm('50개 제품 + 각 10건 히스토리(임대5+회수5) + 사진을 생성합니다.\n시간이 다소 걸립니다. 계속하시겠습니까?')) return;

    const progressEl = document.createElement('div');
    progressEl.id = 'testProgress';
    progressEl.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#1e3a5f;color:#fff;padding:12px 20px;z-index:99999;font-size:14px;text-align:center;';
    document.body.appendChild(progressEl);
    const updateProgress = (msg) => { progressEl.textContent = msg; console.log(msg); };

    try {
        // 1. 테스트 이미지 5개 생성 및 업로드 (한 번만)
        updateProgress('테스트 이미지 생성 중...');
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
        const testPhotoUrls = [];
        for (let c = 0; c < 5; c++) {
            const canvas = document.createElement('canvas');
            canvas.width = 200; canvas.height = 150;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = colors[c];
            ctx.fillRect(0, 0, 200, 150);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 20px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('TEST ' + (c + 1), 100, 80);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
            const ref = storageInstance.ref(`photos/test/test_img_${c}`);
            await ref.putString(dataUrl, 'data_url');
            testPhotoUrls.push(await ref.getDownloadURL());
            updateProgress(`테스트 이미지 업로드 ${c + 1}/5`);
        }

        // 2. 50개 제품 생성
        const categories = ['에어컨', '제습기', '공기청정기', '히터', '선풍기'];
        const companies = ['삼성전자', 'LG전자', '대우', '위닉스', '쿠쿠', '코웨이', '신일', '한일', '캐리어', '센추리'];
        const testProducts = [];

        // 2. 50개 제품 생성 (각 제품에 rentalHistory 5건 포함)
        updateProgress('제품 50개 생성 중...');
        const now = Date.now();
        let historyCount = 0;
        const totalHistory = 50 * 10;

        for (let i = 1; i <= 50; i++) {
            const cat = categories[Math.floor(Math.random() * categories.length)];
            const id = `T${String(i).padStart(3, '0')}`;
            const totalHours = Math.floor(Math.random() * 2000) + 500;
            const sn = generateSerialNumber();

            // 제품별 rentalHistory 배열 생성 (5회 임대+회수)
            const rentalHistory = [];
            let remainingHours = totalHours;
            for (let r = 0; r < 5; r++) {
                const company = companies[Math.floor(Math.random() * companies.length)];
                const usedHours = Math.floor(Math.random() * 100) + 10;
                const rentalDate = new Date(now - (50 - i) * 86400000 - (5 - r) * 7200000).toISOString();
                const returnDate = new Date(now - (50 - i) * 86400000 - (5 - r) * 7200000 + 3600000).toISOString();
                remainingHours = Math.max(0, remainingHours - usedHours);

                rentalHistory.push({
                    type: '임대',
                    company,
                    rentalDate,
                    returnDate,
                    remainingHoursAtRental: remainingHours + usedHours,
                    remainingHoursAtReturn: remainingHours,
                    usedHours,
                    note: r === 0 ? '테스트 특이사항' : '',
                    photos: testPhotoUrls,
                    returnPhotos: testPhotoUrls
                });
            }

            const lastStatus = STATUS_TYPES[Math.floor(Math.random() * STATUS_TYPES.length)];
            const product = {
                id, name: `${cat} ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}형`,
                category: cat, totalHours, remainingHours,
                note: '', status: lastStatus, isRented: false,
                rentalCompany: null, rentalDate: null,
                serialNumber: sn, rentalHistory,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            };
            testProducts.push(product);
            updateProgress(`제품 생성 중... ${i}/50`);
        }

        // Firestore 일괄 저장 (500개 제한 → 제품 50개씩은 OK)
        const productBatch = db.batch();
        testProducts.forEach(p => productBatch.set(db.collection('products').doc(p.id), p));
        await productBatch.commit();
        updateProgress('제품 50개 등록 완료 (각 임대기록 5건 포함)');

        // 3. 히스토리 컬렉션에도 기록 생성 (관리자 히스토리 탭용)
        for (let p = 0; p < 50; p++) {
            const prod = testProducts[p];
            const batch = db.batch();

            for (let r = 0; r < 5; r++) {
                const rental = prod.rentalHistory[r];

                // 임대 기록
                const rentalRef = db.collection('history').doc();
                batch.set(rentalRef, {
                    type: '임대', productId: prod.id, productName: prod.name,
                    company: rental.company, time: rental.rentalDate,
                    rentalPhotos: testPhotoUrls,
                    userId: currentUser.uid, userName: currentUserProfile.name,
                    userDepartment: currentUserProfile.department, userEmail: currentUser.email
                });

                // 회수 기록
                const returnRef = db.collection('history').doc();
                batch.set(returnRef, {
                    type: '임대회수', productId: prod.id, productName: prod.name,
                    company: rental.company, returnStatus: prod.status,
                    usedHours: rental.usedHours, note: rental.note,
                    time: rental.returnDate,
                    returnPhotos: testPhotoUrls,
                    userId: currentUser.uid, userName: currentUserProfile.name,
                    userDepartment: currentUserProfile.department, userEmail: currentUser.email
                });

                historyCount += 2;
            }

            await batch.commit();
            updateProgress(`히스토리 생성 중... ${p + 1}/50 제품 (${historyCount}/${totalHistory}건)`);
        }

        // 4. 데이터 새로고침
        updateProgress('데이터 새로고침 중...');
        await loadData();
        updateDashboard();
        updateProductList();
        updateAutoCompleteSuggestions();

        progressEl.style.background = '#10b981';
        updateProgress(`완료! 제품 50개 + 히스토리 ${historyCount}건 + 사진 URL ${historyCount * 5}개 생성됨`);
        setTimeout(() => progressEl.remove(), 5000);

    } catch (e) {
        console.error('테스트 데이터 생성 오류:', e);
        progressEl.style.background = '#ef4444';
        updateProgress('오류: ' + e.message);
        setTimeout(() => progressEl.remove(), 10000);
    }
}

// 테스트 데이터 삭제
async function deleteTestData() {
    if (!isAdmin) { showToast('관리자만 사용 가능합니다.', 'error'); return; }
    if (!confirm('T001~T050 테스트 제품과 관련 히스토리를 모두 삭제합니다. 계속하시겠습니까?')) return;

    const progressEl = document.createElement('div');
    progressEl.id = 'testProgress';
    progressEl.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ef4444;color:#fff;padding:12px 20px;z-index:99999;font-size:14px;text-align:center;';
    document.body.appendChild(progressEl);
    const updateProgress = (msg) => { progressEl.textContent = msg; };

    try {
        // 제품 삭제
        updateProgress('테스트 제품 삭제 중...');
        for (let i = 1; i <= 50; i++) {
            const id = `T${String(i).padStart(3, '0')}`;
            await db.collection('products').doc(id).delete();
        }

        // 히스토리 삭제 (T001~T050 관련)
        updateProgress('히스토리 삭제 중...');
        for (let i = 1; i <= 50; i++) {
            const id = `T${String(i).padStart(3, '0')}`;
            const snap = await db.collection('history').where('productId', '==', id).get();
            const batch = db.batch();
            snap.forEach(doc => batch.delete(doc.ref));
            if (!snap.empty) await batch.commit();
            updateProgress(`히스토리 삭제 중... ${i}/50`);
        }

        // Storage 테스트 이미지 삭제
        updateProgress('테스트 이미지 삭제 중...');
        for (let c = 0; c < 5; c++) {
            try { await storageInstance.ref(`photos/test/test_img_${c}`).delete(); } catch(e) {}
        }

        await loadData();
        updateDashboard();
        updateProductList();

        progressEl.style.background = '#10b981';
        updateProgress('테스트 데이터 삭제 완료!');
        setTimeout(() => progressEl.remove(), 3000);
    } catch (e) {
        console.error('삭제 오류:', e);
        updateProgress('오류: ' + e.message);
        setTimeout(() => progressEl.remove(), 10000);
    }
}

window.generateTestData = generateTestData;
window.deleteTestData = deleteTestData;
