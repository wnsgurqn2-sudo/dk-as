/**
 * DK AS - 임대제품 점검 시스템
 * 메인 JavaScript 파일
 */

// ===== 상수 정의 =====
const STORAGE_KEY = 'dk_as_products';
const HISTORY_KEY = 'dk_as_scan_history';
const STATUS_TYPES = ['미점검', '고장', '청소', '출고준비완료'];

// ===== 상태 관리 =====
let products = [];
let scanHistory = [];
let currentFilter = 'all';
let html5QrCode = null;
let isScanning = false;

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initTabs();
    initProductForm();
    initBulkRegister();
    initFilters();
    initQRGenerator();
    initModal();
    initDeleteAll();
    updateDashboard();
    updateProductList();
    updateQRProductSelect();
    updateQRSheetProductList();
});

// ===== 데이터 관리 =====
function loadData() {
    const savedProducts = localStorage.getItem(STORAGE_KEY);
    const savedHistory = localStorage.getItem(HISTORY_KEY);

    if (savedProducts) {
        products = JSON.parse(savedProducts);
    }
    if (savedHistory) {
        scanHistory = JSON.parse(savedHistory);
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(scanHistory));
}

// ===== 탭 관리 =====
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // 탭 버튼 활성화
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 탭 컨텐츠 활성화
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tabId).classList.add('active');

            // QR 스캔 탭 처리
            if (tabId === 'scan') {
                initQRScanner();
            } else {
                stopQRScanner();
            }

            // 대시보드 탭이면 업데이트
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
        (errorMessage) => {
            // QR 코드가 없을 때는 무시
        }
    ).then(() => {
        isScanning = true;
    }).catch((err) => {
        console.error("카메라 시작 실패:", err);
        showToast('카메라를 시작할 수 없습니다. 카메라 권한을 확인해주세요.', 'error');
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
    // QR 형식: 제품ID_상태 (예: P001_청소)
    const parts = decodedText.split('_');

    if (parts.length < 2) {
        showScanResult(null, null, '잘못된 QR코드 형식입니다.');
        return;
    }

    const productId = parts[0];
    const status = parts.slice(1).join('_'); // 상태에 _ 가 있을 수 있음

    // 유효한 상태인지 확인
    if (!STATUS_TYPES.includes(status)) {
        showScanResult(productId, status, '유효하지 않은 상태입니다.');
        return;
    }

    // 제품 찾기
    const productIndex = products.findIndex(p => p.id === productId);

    if (productIndex === -1) {
        showScanResult(productId, status, '등록되지 않은 제품입니다.');
        return;
    }

    // 상태 업데이트
    const oldStatus = products[productIndex].status;
    products[productIndex].status = status;
    products[productIndex].lastUpdated = new Date().toISOString();
    saveData();

    // 스캔 기록 추가
    addScanHistory(productId, products[productIndex].name, status);

    // 결과 표시
    showScanResult(productId, status, `상태가 "${oldStatus}" → "${status}"로 변경되었습니다.`);

    // 대시보드 업데이트
    updateDashboard();

    // 성공 토스트
    showToast(`${products[productIndex].name}: ${status}`, 'success');

    // 잠시 후 스캐너 재시작 (중복 스캔 방지)
    stopQRScanner();
    setTimeout(() => {
        initQRScanner();
    }, 2000);
}

function showScanResult(productId, status, message) {
    const resultDiv = document.getElementById('scanResult');
    resultDiv.style.display = 'block';

    document.getElementById('scannedProductId').textContent = productId || '-';
    document.getElementById('scannedStatus').textContent = status || '-';
    document.getElementById('scanMessage').textContent = message;

    // 상태에 따른 스타일 변경
    if (message.includes('변경되었습니다')) {
        resultDiv.style.borderColor = '#10b981';
        document.querySelector('.result-header').style.color = '#10b981';
    } else {
        resultDiv.style.borderColor = '#ef4444';
        document.querySelector('.result-header').style.color = '#ef4444';
    }
}

function addScanHistory(productId, productName, status) {
    const historyItem = {
        productId,
        productName,
        status,
        time: new Date().toISOString()
    };

    scanHistory.unshift(historyItem);

    // 최대 50개까지만 저장
    if (scanHistory.length > 50) {
        scanHistory = scanHistory.slice(0, 50);
    }

    saveData();
    updateScanHistory();
}

function updateScanHistory() {
    const listDiv = document.getElementById('scanHistoryList');

    if (scanHistory.length === 0) {
        listDiv.innerHTML = '<div class="empty-state">스캔 기록이 없습니다.</div>';
        return;
    }

    listDiv.innerHTML = scanHistory.slice(0, 10).map(item => {
        const time = new Date(item.time);
        const timeStr = time.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="history-item">
                <span class="history-time">${timeStr}</span>
                <span class="history-product">${item.productName} (${item.productId})</span>
                <span class="product-status ${item.status}">${item.status}</span>
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
        const note = document.getElementById('productNote').value.trim();

        // 중복 ID 확인
        if (products.some(p => p.id === id)) {
            showToast('이미 등록된 제품 ID입니다.', 'error');
            return;
        }

        // 제품 추가
        const product = {
            id,
            name,
            category: category || '기타',
            note,
            status: '미점검',
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        products.push(product);
        saveData();

        // 폼 초기화
        form.reset();

        // UI 업데이트
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

            if (parts.length < 2) {
                skippedCount++;
                return;
            }

            const id = parts[0];
            const name = parts[1];
            const category = parts[2] || '기타';

            // 중복 ID 확인
            if (products.some(p => p.id === id)) {
                skippedCount++;
                return;
            }

            products.push({
                id,
                name,
                category,
                note: '',
                status: '미점검',
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            });

            addedCount++;
        });

        saveData();

        // 입력 초기화
        document.getElementById('bulkInput').value = '';

        // UI 업데이트
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
                <div class="product-id">${product.id}</div>
            </div>
            <span class="product-category">${product.category}</span>
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
}

function updateDashboard() {
    // 통계 업데이트
    const total = products.length;
    const unchecked = products.filter(p => p.status === '미점검').length;
    const broken = products.filter(p => p.status === '고장').length;
    const cleaning = products.filter(p => p.status === '청소').length;
    const ready = products.filter(p => p.status === '출고준비완료').length;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statUnchecked').textContent = unchecked;
    document.getElementById('statBroken').textContent = broken;
    document.getElementById('statCleaning').textContent = cleaning;
    document.getElementById('statReady').textContent = ready;

    // 진행률 업데이트 (미점검 제외한 비율)
    const checked = total - unchecked;
    const progressPercent = total > 0 ? Math.round((checked / total) * 100) : 0;

    document.getElementById('progressPercent').textContent = progressPercent + '%';
    document.getElementById('progressFill').style.width = progressPercent + '%';

    // 최종 업데이트 시간
    document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('ko-KR');

    // 필터링된 제품 목록 업데이트
    updateDashboardList();

    // 스캔 기록 업데이트
    updateScanHistory();
}

function updateDashboardList() {
    const listDiv = document.getElementById('dashboardList');

    let filteredProducts = products;

    if (currentFilter !== 'all') {
        filteredProducts = products.filter(p => p.status === currentFilter);
    }

    if (filteredProducts.length === 0) {
        listDiv.innerHTML = `<div class="empty-state">
            ${currentFilter === 'all' ? '등록된 제품이 없습니다.<br>제품관리 탭에서 제품을 등록해주세요.' : '해당하는 제품이 없습니다.'}
        </div>`;
        return;
    }

    listDiv.innerHTML = filteredProducts.map(product => `
        <div class="product-item" data-id="${product.id}">
            <span class="product-status-badge ${product.status}"></span>
            <div class="product-info">
                <div class="product-name">${product.name}</div>
                <div class="product-id">${product.id}</div>
            </div>
            <span class="product-category">${product.category}</span>
            <span class="product-status ${product.status}">${product.status}</span>
        </div>
    `).join('');
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
    const status = document.getElementById('qrStatusSelect').value;

    if (!productId) {
        showToast('제품을 선택해주세요.', 'error');
        return;
    }

    // QRCode 라이브러리 확인
    if (typeof QRCode === 'undefined') {
        showToast('QR 라이브러리 로딩 중... 잠시 후 다시 시도해주세요.', 'error');
        return;
    }

    const product = products.find(p => p.id === productId);
    const qrText = `${productId}_${status}`;

    const canvas = document.getElementById('qrCanvas');

    try {
        QRCode.toCanvas(canvas, qrText, {
            width: 200,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        }, (error) => {
            if (error) {
                console.error('QR 생성 오류:', error);
                showToast('QR코드 생성에 실패했습니다: ' + error.message, 'error');
                return;
            }

            document.getElementById('qrPreview').style.display = 'block';
            document.getElementById('qrText').textContent = `${product.name} - ${status}`;
            showToast('QR코드가 생성되었습니다.', 'success');
        });
    } catch (e) {
        console.error('QR 생성 예외:', e);
        showToast('QR코드 생성 오류: ' + e.message, 'error');
    }
}

function downloadQR() {
    const canvas = document.getElementById('qrCanvas');
    const productId = document.getElementById('qrProductSelect').value;
    const status = document.getElementById('qrStatusSelect').value;

    const link = document.createElement('a');
    link.download = `QR_${productId}_${status}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

function generateQRSheet() {
    const checkboxes = document.querySelectorAll('#qrSheetProductList input[type="checkbox"]:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    if (selectedIds.length === 0) {
        showToast('제품을 선택해주세요.', 'error');
        return;
    }

    // QRCode 라이브러리 확인
    if (typeof QRCode === 'undefined') {
        showToast('QR 라이브러리 로딩 중... 잠시 후 다시 시도해주세요.', 'error');
        return;
    }

    const sheetDiv = document.getElementById('qrSheet');
    const previewDiv = document.getElementById('qrSheetPreview');

    sheetDiv.innerHTML = '';

    // 각 제품의 모든 상태 QR 생성
    selectedIds.forEach(productId => {
        const product = products.find(p => p.id === productId);

        STATUS_TYPES.forEach(status => {
            const qrText = `${productId}_${status}`;
            const itemDiv = document.createElement('div');
            itemDiv.className = 'qr-sheet-item';

            const canvas = document.createElement('canvas');
            const label = document.createElement('div');
            label.className = 'qr-label';
            label.textContent = `${product.name}\n${status}`;

            itemDiv.appendChild(canvas);
            itemDiv.appendChild(label);
            sheetDiv.appendChild(itemDiv);

            try {
                QRCode.toCanvas(canvas, qrText, {
                    width: 100,
                    margin: 1
                });
            } catch (e) {
                console.error('QR 시트 생성 오류:', e);
            }
        });
    });

    previewDiv.style.display = 'block';
    previewDiv.scrollIntoView({ behavior: 'smooth' });

    showToast(`${selectedIds.length}개 제품의 QR코드 시트가 생성되었습니다.`, 'success');
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

// 전역 함수로 노출
window.deleteProduct = deleteProduct;
