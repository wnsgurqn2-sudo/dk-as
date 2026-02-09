/**
 * DK AS - 임대제품 점검 시스템
 * 메인 JavaScript 파일
 */

// ===== 상수 정의 =====
const STORAGE_KEY = 'dk_as_products';
const HISTORY_KEY = 'dk_as_history';
const PHOTOS_KEY = 'dk_as_photos';
const STATUS_TYPES = ['미점검', '수리대기', '수리완료', '청소대기', '청소완료', '출고준비완료'];

// 상태별 진행률
const STATUS_PROGRESS = {
    '미점검': 0,
    '수리대기': 0,
    '수리완료': 50,
    '청소대기': 70,
    '청소완료': 90,
    '출고준비완료': 100
};

// ===== 상태 관리 =====
let products = [];
let history = [];
let photos = {};
let currentFilter = 'all';
let searchKeyword = '';
let html5QrCode = null;
let isScanning = false;
let currentScannedProduct = null;
let currentPhotoType = null; // 'rental' or 'return'

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initTabs();
    initProductForm();
    initBulkRegister();
    initFilters();
    initSearch();
    initQRGenerator();
    initModal();
    initEditProductModal();
    initRentalHistoryModal();
    initPhotoCapture();
    initDeleteAll();
    initScanActions();
    updateDashboard();
    updateProductList();
    updateQRProductSelect();
    updateQRSheetProductList();
});

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

// ===== 사진 촬영 =====
function initPhotoCapture() {
    // 임대 사진 촬영
    document.getElementById('rentalPhotoInput').addEventListener('change', (e) => {
        handlePhotoCapture(e, 'rentalPhotoPreview');
    });

    // 회수 사진 촬영
    document.getElementById('returnPhotoInput').addEventListener('change', (e) => {
        handlePhotoCapture(e, 'returnPhotoPreview');
    });
}

function handlePhotoCapture(event, previewId) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById(previewId);
        preview.src = e.target.result;
        preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

// ===== 데이터 관리 =====
function loadData() {
    const savedProducts = localStorage.getItem(STORAGE_KEY);
    const savedHistory = localStorage.getItem(HISTORY_KEY);
    const savedPhotos = localStorage.getItem(PHOTOS_KEY);

    if (savedProducts) {
        products = JSON.parse(savedProducts);
    }
    if (savedHistory) {
        history = JSON.parse(savedHistory);
    }
    if (savedPhotos) {
        photos = JSON.parse(savedPhotos);
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function savePhotos() {
    localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos));
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
    document.getElementById('scanActionPanel').style.display = 'none';
    document.getElementById('rentalForm').style.display = 'none';
    document.getElementById('returnForm').style.display = 'none';
    document.getElementById('statusForm').style.display = 'none';

    // 사진 미리보기 초기화
    document.getElementById('rentalPhotoPreview').src = '';
    document.getElementById('rentalPhotoPreview').style.display = 'none';
    document.getElementById('rentalPhotoInput').value = '';
    document.getElementById('returnPhotoPreview').src = '';
    document.getElementById('returnPhotoPreview').style.display = 'none';
    document.getElementById('returnPhotoInput').value = '';

    currentScannedProduct = null;

    // 스캐너 재시작
    setTimeout(() => {
        initQRScanner();
    }, 500);
}

// ===== 스캔 액션 (임대/회수/상태변경) =====
function initScanActions() {
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
    document.getElementById('btnRentalSave').addEventListener('click', () => {
        const company = document.getElementById('rentalCompany').value.trim();
        const photoData = document.getElementById('rentalPhotoPreview').src;

        if (!company) {
            showToast('업체명을 입력해주세요.', 'error');
            return;
        }

        // 제품 임대 처리
        const productIndex = products.findIndex(p => p.id === currentScannedProduct.id);
        if (productIndex !== -1) {
            const rentalRecord = {
                type: '임대',
                company: company,
                rentalDate: new Date().toISOString(),
                remainingHoursAtRental: products[productIndex].remainingHours || products[productIndex].totalHours,
                photo: photoData && photoData !== '' ? photoData : null
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

        hideScanActionPanel();
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

    // 임대회수 상태 버튼 클릭
    document.querySelectorAll('#returnStatusButtons .status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const status = btn.dataset.status;
            const newRemaining = parseInt(document.getElementById('returnHours').value) || 0;
            const note = document.getElementById('returnNote').value.trim();
            const photoData = document.getElementById('returnPhotoPreview').src;

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
                        currentRental.returnPhoto = photoData && photoData !== '' ? photoData : null;
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
                    status: status,
                    time: new Date().toISOString()
                };

                products[productIndex].remainingHours = newRemaining;
                products[productIndex].isRented = false;
                products[productIndex].status = status;
                products[productIndex].lastUpdated = new Date().toISOString();
                products[productIndex].lastNote = note;
                products[productIndex].lastCompany = products[productIndex].rentalCompany;
                products[productIndex].lastUsedHours = usedHours;
                products[productIndex].rentalCompany = null;
                products[productIndex].rentalDate = null;
                products[productIndex].currentRentalIndex = null;

                saveData();
                addHistory(returnRecord);

                showToast(`${currentScannedProduct.name} 회수 완료 - 실사용: ${usedHours}h, ${status}`, 'success');
                updateDashboard();
            }

            hideScanActionPanel();
        });
    });

    // 상태변경 버튼 클릭
    document.querySelectorAll('#statusChangeButtons .status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const status = btn.dataset.status;
            const note = document.getElementById('statusNote').value.trim();

            const productIndex = products.findIndex(p => p.id === currentScannedProduct.id);
            if (productIndex !== -1) {
                const previousStatus = products[productIndex].status;

                products[productIndex].status = status;
                products[productIndex].lastUpdated = new Date().toISOString();
                products[productIndex].lastNote = note;

                saveData();

                addHistory({
                    type: '상태변경',
                    productId: currentScannedProduct.id,
                    productName: currentScannedProduct.name,
                    previousStatus: previousStatus,
                    newStatus: status,
                    note: note,
                    time: new Date().toISOString()
                });

                showToast(`${currentScannedProduct.name} 상태 변경: ${status}`, 'success');
                updateDashboard();
            }

            hideScanActionPanel();
        });
    });
}

// ===== 기록 관리 =====
function addHistory(record) {
    history.unshift(record);
    if (history.length > 100) {
        history = history.slice(0, 100);
    }
    saveData();
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
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        products.push(product);
        saveData();
        form.reset();

        updateDashboard();
        updateProductList();
        updateQRProductSelect();
        updateQRSheetProductList();

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
                products = [];
                saveData();

                updateDashboard();
                updateProductList();
                updateQRProductSelect();
                updateQRSheetProductList();

                showToast('모든 제품이 삭제되었습니다.', 'success');
            }
        );
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

    listDiv.innerHTML = products.map(product => `
        <div class="product-item" data-id="${product.id}">
            <span class="product-status-badge ${product.status}"></span>
            <div class="product-info">
                <div class="product-name">${product.name}</div>
                <div class="product-id">${product.id} | ${product.remainingHours || product.totalHours}h</div>
            </div>
            <span class="product-category">${product.category}</span>
            ${product.isRented ? `<span class="rental-badge">임대중</span>` : ''}
            <span class="product-status ${product.status}">${product.status}</span>
            <div class="product-actions">
                <button class="btn-icon danger" onclick="deleteProduct('${product.id}')" title="삭제">🗑️</button>
            </div>
        </div>
    `).join('');
}

function deleteProduct(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    showModal(
        '제품 삭제',
        `"${product.name}" (${product.id})을(를) 삭제하시겠습니까?`,
        () => {
            products = products.filter(p => p.id !== productId);
            saveData();

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
    // 통계 계산 (6개 상태)
    const total = products.length;
    const unchecked = products.filter(p => p.status === '미점검').length;
    const repairWait = products.filter(p => p.status === '수리대기').length;
    const repairDone = products.filter(p => p.status === '수리완료').length;
    const cleanWait = products.filter(p => p.status === '청소대기').length;
    const cleanDone = products.filter(p => p.status === '청소완료').length;
    const ready = products.filter(p => p.status === '출고준비완료').length;

    // 통계 카드 업데이트
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statUnchecked').textContent = unchecked;
    document.getElementById('statRepairWait').textContent = repairWait;
    document.getElementById('statRepairDone').textContent = repairDone;
    document.getElementById('statCleanWait').textContent = cleanWait;
    document.getElementById('statCleanDone').textContent = cleanDone;
    document.getElementById('statReady').textContent = ready;

    // 필터 버튼 개수 업데이트
    document.getElementById('filterCountAll').textContent = total;
    document.getElementById('filterCountUnchecked').textContent = unchecked;
    document.getElementById('filterCountRepairWait').textContent = repairWait;
    document.getElementById('filterCountRepairDone').textContent = repairDone;
    document.getElementById('filterCountCleanWait').textContent = cleanWait;
    document.getElementById('filterCountCleanDone').textContent = cleanDone;
    document.getElementById('filterCountReady').textContent = ready;

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

    // 필터링
    let filteredProducts = products;

    if (currentFilter !== 'all') {
        filteredProducts = filteredProducts.filter(p => p.status === currentFilter);
    }

    // 검색
    if (searchKeyword) {
        filteredProducts = filteredProducts.filter(p =>
            p.name.toLowerCase().includes(searchKeyword) ||
            p.id.toLowerCase().includes(searchKeyword) ||
            (p.rentalCompany && p.rentalCompany.toLowerCase().includes(searchKeyword)) ||
            (p.lastCompany && p.lastCompany.toLowerCase().includes(searchKeyword))
        );
    }

    if (filteredProducts.length === 0) {
        listDiv.innerHTML = `<div class="empty-state">
            ${searchKeyword ? '검색 결과가 없습니다.' : (currentFilter === 'all' ? '등록된 제품이 없습니다.' : '해당하는 제품이 없습니다.')}
        </div>`;
        return;
    }

    listDiv.innerHTML = filteredProducts.map(product => {
        const rentalInfo = product.isRented ?
            `<span class="rental-badge">임대중: ${product.rentalCompany}</span>` :
            (product.lastCompany ? `<span class="last-rental">최근: ${product.lastCompany}</span>` : '');

        return `
            <div class="product-item dashboard-item" data-id="${product.id}">
                <span class="product-status-badge ${product.status}"></span>
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-id">${product.id} | 잔여: ${product.remainingHours || product.totalHours}h</div>
                    ${rentalInfo}
                    ${product.lastNote ? `<div class="product-note">메모: ${product.lastNote}</div>` : ''}
                </div>
                <span class="product-status ${product.status}">${product.status}</span>
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

// ===== QR 코드 생성 =====
function initQRGenerator() {
    const generateBtn = document.getElementById('generateQrBtn');
    const downloadBtn = document.getElementById('downloadQrBtn');
    const generateSheetBtn = document.getElementById('generateSheetBtn');
    const selectAllBtn = document.getElementById('selectAllProductsBtn');
    const printSheetBtn = document.getElementById('printSheetBtn');

    generateBtn.addEventListener('click', generateSingleQR);
    downloadBtn.addEventListener('click', downloadQR);
    generateSheetBtn.addEventListener('click', generateQRSheet);
    selectAllBtn.addEventListener('click', selectAllProducts);
    printSheetBtn.addEventListener('click', () => window.print());
}

function updateQRProductSelect() {
    const select = document.getElementById('qrProductSelect');

    select.innerHTML = '<option value="">제품을 선택하세요</option>' +
        products.map(p => `<option value="${p.id}">${p.name} (${p.id})</option>`).join('');
}

function updateQRSheetProductList() {
    const listDiv = document.getElementById('qrSheetProductList');

    if (products.length === 0) {
        listDiv.innerHTML = '<div class="empty-state">등록된 제품이 없습니다.</div>';
        return;
    }

    listDiv.innerHTML = products.map(p => `
        <div class="checkbox-item">
            <input type="checkbox" id="qr_${p.id}" value="${p.id}">
            <label for="qr_${p.id}">${p.name} (${p.id})</label>
        </div>
    `).join('');
}

function selectAllProducts() {
    const checkboxes = document.querySelectorAll('#qrSheetProductList input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    checkboxes.forEach(cb => {
        cb.checked = !allChecked;
    });
}

function generateSingleQR() {
    const productId = document.getElementById('qrProductSelect').value;

    if (!productId) {
        showToast('제품을 선택해주세요.', 'error');
        return;
    }

    if (typeof QRCode === 'undefined') {
        showToast('QR 라이브러리 로딩 중... 잠시 후 다시 시도해주세요.', 'error');
        return;
    }

    const product = products.find(p => p.id === productId);
    const qrText = productId; // 제품ID만 QR에 포함

    const qrContainer = document.getElementById('qrCanvas');
    qrContainer.innerHTML = '';

    try {
        new QRCode(qrContainer, {
            text: qrText,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });

        document.getElementById('qrPreview').style.display = 'block';
        document.getElementById('qrText').textContent = `${product.name} (${product.id})`;
        showToast('QR코드가 생성되었습니다.', 'success');
    } catch (e) {
        console.error('QR 생성 예외:', e);
        showToast('QR코드 생성 오류: ' + e.message, 'error');
    }
}

function downloadQR() {
    const qrContainer = document.getElementById('qrCanvas');
    const productId = document.getElementById('qrProductSelect').value;

    const img = qrContainer.querySelector('img');
    const canvas = qrContainer.querySelector('canvas');

    const link = document.createElement('a');
    link.download = `QR_${productId}.png`;

    if (canvas) {
        link.href = canvas.toDataURL('image/png');
    } else if (img) {
        link.href = img.src;
    }

    link.click();
}

function generateQRSheet() {
    const checkboxes = document.querySelectorAll('#qrSheetProductList input[type="checkbox"]:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    if (selectedIds.length === 0) {
        showToast('제품을 선택해주세요.', 'error');
        return;
    }

    if (typeof QRCode === 'undefined') {
        showToast('QR 라이브러리 로딩 중... 잠시 후 다시 시도해주세요.', 'error');
        return;
    }

    const sheetDiv = document.getElementById('qrSheet');
    const previewDiv = document.getElementById('qrSheetPreview');

    sheetDiv.innerHTML = '';

    selectedIds.forEach(productId => {
        const product = products.find(p => p.id === productId);

        const itemDiv = document.createElement('div');
        itemDiv.className = 'qr-sheet-item';

        const qrDiv = document.createElement('div');
        const label = document.createElement('div');
        label.className = 'qr-label';
        label.innerHTML = `${product.name}<br>${product.id}`;

        itemDiv.appendChild(qrDiv);
        itemDiv.appendChild(label);
        sheetDiv.appendChild(itemDiv);

        try {
            new QRCode(qrDiv, {
                text: productId,
                width: 100,
                height: 100,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        } catch (e) {
            console.error('QR 시트 생성 오류:', e);
        }
    });

    previewDiv.style.display = 'block';
    previewDiv.scrollIntoView({ behavior: 'smooth' });

    showToast(`${selectedIds.length}개 제품의 QR코드가 생성되었습니다.`, 'success');
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

    closeBtn.addEventListener('click', closeEditProductModal);
    cancelBtn.addEventListener('click', closeEditProductModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeEditProductModal();
        }
    });

    // QR 다운로드 버튼
    downloadBtn.addEventListener('click', () => {
        if (!currentEditProduct) return;

        const qrContainer = document.getElementById('editQrCode');
        const img = qrContainer.querySelector('img');
        const canvas = qrContainer.querySelector('canvas');

        const link = document.createElement('a');
        link.download = `QR_${currentEditProduct.id}.png`;

        if (canvas) {
            link.href = canvas.toDataURL('image/png');
        } else if (img) {
            link.href = img.src;
        }

        link.click();
        showToast('QR코드가 다운로드되었습니다.', 'success');
    });

    // 기록 버튼 - 임대 기록 표시
    historyBtn.addEventListener('click', () => {
        if (!currentEditProduct) return;
        showRentalHistory(currentEditProduct.id);
    });

    saveBtn.addEventListener('click', () => {
        if (!currentEditProduct) return;

        const newStatus = document.getElementById('editProductStatus').value;
        const newNote = document.getElementById('editProductNote').value.trim();

        const productIndex = products.findIndex(p => p.id === currentEditProduct.id);
        if (productIndex !== -1) {
            const previousStatus = products[productIndex].status;

            products[productIndex].status = newStatus;
            products[productIndex].lastNote = newNote;
            products[productIndex].lastUpdated = new Date().toISOString();

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
            updateDashboard();
        }

        closeEditProductModal();
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
            const rentalDate = new Date(record.rentalDate).toLocaleDateString('ko-KR');
            const returnDate = record.returnDate ? new Date(record.returnDate).toLocaleDateString('ko-KR') : '임대중';
            const usedHours = record.usedHours !== undefined ? `${record.usedHours}시간` : '-';
            const note = record.note || '-';

            return `
                <div class="rental-history-item">
                    <div class="rental-history-header">
                        <span class="rental-company">${record.company}</span>
                        <span class="rental-date">${rentalDate} ~ ${returnDate}</span>
                    </div>
                    <div class="rental-history-details">
                        <span>사용시간: ${usedHours}</span>
                        <span>비고: ${note}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('rentalHistoryContent').innerHTML = historyHtml;
    document.getElementById('rentalHistoryModal').classList.add('show');
}

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
    document.getElementById('editProductStatus').value = product.status;
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
    } catch (e) {
        console.error('QR 생성 오류:', e);
    }
}

function closeEditProductModal() {
    document.getElementById('editProductModal').classList.remove('show');
    currentEditProduct = null;
}

// 전역 함수로 노출
window.deleteProduct = deleteProduct;
