// ==========================================
// 1. KONFIGURASI & STATE
// ==========================================

// PENTING: Ganti URL di bawah ini dengan URL Web App (Exec) terbaru Anda!
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwV_H2oV4RXQzV0RnkdaabDhbBT51swvPmxYsZyhw9RSzTw85TRU2yv7zWtkffvRcOU/exec';

// State Aplikasi Utama
let databaseBarang = [];
let keranjang = [];
let jenisUnik = [];
let riwayatTransaksi = []; 
let currentViewedTx = null;
let editingTxId = null;
let currentUserRole = null;

// State Dashboard
let allSoldItems = []; 
let chartJenisBarang, chartTopProduk; 
let selectedJenis = [];
let selectedUkuran = [];
let uniqueCustomers = []; 

// State Printer & Offline
let printerDevice = null;
let printerCharacteristic = null;
let isPrinting = false;
let offlineQueue = JSON.parse(localStorage.getItem('pos_offline_queue') || '[]');


// ==========================================
// 2. INISIALISASI & SERVICE WORKER
// ==========================================

window.onload = () => {
    // Registrasi PWA Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').then(() => console.log("Service Worker Registered"));
    }

    // Cek Login Sesi
    const savedRole = sessionStorage.getItem('pos_role');
    if (savedRole) {
        processLoginSuccess(savedRole);
    }

    // Cek Koneksi Internet
    updateNetworkStatus();
    window.addEventListener('online',  () => { updateNetworkStatus(); processOfflineQueue(); });
    window.addEventListener('offline', () => updateNetworkStatus());
    updateQueueUI();
};

function updateNetworkStatus() {
    const indicator = document.getElementById('offline-indicator');
    if (!indicator) return; // Safety check jika elemen belum ada di HTML
    
    if (!navigator.onLine) {
        indicator.classList.remove('hidden');
        indicator.classList.add('flex');
        showToast("Mode Offline: Data akan disimpan di HP dulu.", "info");
    } else {
        if (offlineQueue.length === 0) indicator.classList.add('hidden');
    }
}

function updateQueueUI() {
    const countEl = document.getElementById('queue-count');
    const indicator = document.getElementById('offline-indicator');
    if (countEl) countEl.innerText = offlineQueue.length;
    
    if (indicator) {
        if (offlineQueue.length > 0) {
            indicator.classList.remove('hidden');
            indicator.classList.add('flex');
        } else if (navigator.onLine) {
            indicator.classList.add('hidden');
        }
    }
}


// ==========================================
// 3. UTILITIES (Toast, Loading, Tab)
// ==========================================

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return; 

    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-600' : (type === 'error' ? 'bg-red-600' : (type === 'info' ? 'bg-yellow-500' : 'bg-blue-600'));
    
    toast.className = `${bgColor} text-white px-6 py-3 rounded-lg shadow-lg font-medium flex items-center gap-2 toast-enter`;
    toast.innerHTML = `
        ${type === 'success' ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : ''}
        ${type === 'error' ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' : ''}
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-enter-active');
    });
    
    setTimeout(() => {
        toast.classList.remove('toast-enter-active');
        toast.classList.add('toast-exit-active');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function toggleLoading(show, text = 'Memuat Data...') {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    if (textEl) textEl.innerText = text;
    
    if(show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
}

function switchTab(pageId) {
    document.querySelectorAll('.page-section').forEach(p => p.classList.add('hidden'));
    const target = document.getElementById(pageId);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.className = "tab-btn px-4 py-2 rounded-md font-semibold text-gray-600 hover:bg-gray-100 transition whitespace-nowrap";
    });
    
    const activeTabId = pageId.replace('page-', 'tab-');
    const activeTab = document.getElementById(activeTabId);
    if(activeTab) {
        activeTab.className = "tab-btn px-4 py-2 rounded-md font-semibold text-blue-600 bg-blue-50 transition whitespace-nowrap";
    }

    if (pageId === 'page-dashboard' && allSoldItems.length === 0) {
        loadDashboardData();
    }
    if (pageId === 'page-users') {
        loadUsers();
    }
}


// ==========================================
// 4. CORE: OFFLINE SYNC SYSTEM
// ==========================================

async function sendData(payload, successMessage) {
    if (navigator.onLine) {
        try {
            const formData = new URLSearchParams(payload);
            const response = await fetch(SCRIPT_URL, { method: 'POST', body: formData });
            const text = await response.text();
            
            if (text.includes("tersimpan") || text.includes("diperbarui") || text.includes("ditambahkan") || text.includes("dihapus")) {
                showToast(successMessage || text);
                return true;
            } else {
                throw new Error(text);
            }
        } catch (error) {
            console.error("Gagal kirim, masuk antrian:", error);
            saveToQueue(payload);
            return false;
        }
    } else {
        saveToQueue(payload);
        showToast("Offline: Data disimpan. Akan dikirim saat online.", "info");
        return true;
    }
}

function saveToQueue(payload) {
    offlineQueue.push(payload);
    localStorage.setItem('pos_offline_queue', JSON.stringify(offlineQueue));
    updateQueueUI();
}

async function processOfflineQueue() {
    if (offlineQueue.length === 0) return;

    showToast(`Sinkronisasi: Mengirim ${offlineQueue.length} data tertunda...`, "info");
    toggleLoading(true, "Sinkronisasi Data...");

    const queueCopy = [...offlineQueue];
    let successCount = 0;

    for (let i = 0; i < queueCopy.length; i++) {
        const payload = queueCopy[i];
        try {
            const formData = new URLSearchParams(payload);
            await fetch(SCRIPT_URL, { method: 'POST', body: formData });
            
            offlineQueue.shift(); 
            localStorage.setItem('pos_offline_queue', JSON.stringify(offlineQueue));
            updateQueueUI();
            successCount++;
        } catch (error) {
            console.error("Gagal sinkron item ke-" + i, error);
            break; 
        }
    }

    toggleLoading(false);
    if (successCount > 0) {
        showToast(`Sinkronisasi Selesai: ${successCount} data terkirim!`);
        loadDatabase(); 
    }
}


// ==========================================
// 5. LOGIN & USER MANAGEMENT
// ==========================================

async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleLogin(e) {
    e.preventDefault(); 
    if(!navigator.onLine) return showToast("Butuh internet untuk Login!", "error");

    const userInp = document.getElementById('login-username').value.trim();
    const passInpPlain = document.getElementById('login-password').value.trim();
    const errText = document.getElementById('login-error');
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    
    errText.classList.add('hidden');
    btnSubmit.innerText = "Memeriksa...";
    btnSubmit.disabled = true;

    try {
        const hashedPass = await hashPassword(passInpPlain);
        const formData = new URLSearchParams();
        formData.append('action', 'login');
        formData.append('username', userInp);
        formData.append('password', hashedPass);

        const response = await fetch(SCRIPT_URL, { method: 'POST', body: formData });
        const result = await response.json(); 

        if (result.status === 'success') {
            sessionStorage.setItem('pos_role', result.role);
            processLoginSuccess(result.role);
        } else {
            errText.innerText = result.message;
            errText.classList.remove('hidden');
        }
    } catch (error) {
        errText.innerText = "Gagal koneksi server.";
        errText.classList.remove('hidden');
    } finally {
        btnSubmit.innerText = "Masuk";
        btnSubmit.disabled = false;
    }
}

function processLoginSuccess(role) {
    currentUserRole = role;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('app-container').classList.add('flex'); 
    applyRolePermissions();
    if (databaseBarang.length === 0) loadDatabase();
}

function applyRolePermissions() {
    const tabInput = document.getElementById('tab-input');
    const tabDashboard = document.getElementById('tab-dashboard');
    const tabUsers = document.getElementById('tab-users');
    
    if (currentUserRole === 'kasir') {
        tabInput.classList.add('hidden');
        tabDashboard.classList.add('hidden');
        tabUsers.classList.add('hidden');
        switchTab('page-transaksi');
    } else {
        tabInput.classList.remove('hidden');
        tabDashboard.classList.remove('hidden');
        tabUsers.classList.remove('hidden');
        switchTab('page-dashboard');
    }
}

function handleLogout() {
    sessionStorage.removeItem('pos_role');
    currentUserRole = null;
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('flex');
    document.getElementById('login-screen').classList.remove('hidden');
    resetSemua();
}


// ==========================================
// 6. INPUT BARANG
// ==========================================

async function submitBarang(e) {
    e.preventDefault();
    const jenis = document.getElementById('input-jenis').value.trim();
    const nama = document.getElementById('input-nama').value.trim();
    const harga = document.getElementById('input-harga').value;
    const ukuran = document.getElementById('input-ukuran').value.trim();

    const itemExists = databaseBarang.find(i => i.nama.toLowerCase() === nama.toLowerCase() && i.ukuran.toLowerCase() === ukuran.toLowerCase());
    let actionType = itemExists ? 'editBarang' : 'addBarang';

    if (itemExists && !confirm(`Barang sudah ada. Update harga jadi Rp ${parseInt(harga).toLocaleString()}?`)) return;

    toggleLoading(true, 'Menyimpan...');
    
    const payload = {
        action: actionType, jenis, nama, harga, ukuran
    };

    const success = await sendData(payload, itemExists ? "Harga diupdate" : "Barang ditambah");
    
    if(success) {
        document.getElementById('form-barang').reset();
        // Update lokal agar UI responsif
        if(actionType === 'addBarang') {
            databaseBarang.push({ jenis, nama, harga: parseInt(harga), ukuran });
        } else {
            itemExists.harga = parseInt(harga);
        }
        updateDropdownNamaSemua();
    }
    toggleLoading(false);
}


// ==========================================
// 7. TRANSAKSI (KERANJANG & PILIH BARANG)
// ==========================================

function lanjutKePilihBarang() {
    const nama = document.getElementById('trans-nama-pelanggan').value.trim();
    const wa = document.getElementById('trans-no-wa').value.trim();
    if(!nama || !wa) return showToast("Nama dan No WhatsApp wajib diisi!", "error");
    document.getElementById('step-pelanggan').classList.add('hidden');
    document.getElementById('step-barang').classList.remove('hidden');
}

function kembaliKePelanggan() {
    document.getElementById('step-barang').classList.add('hidden');
    document.getElementById('step-pelanggan').classList.remove('hidden');
}

function updateDropdownJenis() {
    const select = document.getElementById('trans-jenis');
    if (!select) return;
    select.innerHTML = '<option value="">-- Semua Jenis --</option>' + 
        jenisUnik.map(j => `<option value="${j}">${j}</option>`).join('');
}

function updateDropdownNamaSemua(filterJenis = "") {
    const select = document.getElementById('trans-nama');
    if (!select) return;
    let items = filterJenis ? databaseBarang.filter(item => item.jenis === filterJenis) : databaseBarang;
    const namaUnik = [...new Set(items.map(item => item.nama).filter(Boolean))];
    select.innerHTML = '<option value="">-- Pilih Barang --</option>' + 
        namaUnik.map(nama => `<option value="${nama}">${nama}</option>`).join('');
}

function syncNamaBerdasarkanJenis() {
    const jenisTerpilih = document.getElementById('trans-jenis').value;
    updateDropdownNamaSemua(jenisTerpilih); 
    resetInputDetail(); 
}

function ubahJenisDropdown(arah) {
    const select = document.getElementById('trans-jenis');
    let index = select.selectedIndex + arah;
    if (index >= 0 && index < select.options.length) {
        select.selectedIndex = index;
        syncNamaBerdasarkanJenis(); 
    }
}

function syncJenisBerdasarkanNama() {
    const namaTerpilih = document.getElementById('trans-nama').value;
    const selectUkuran = document.getElementById('trans-ukuran');
    
    if (namaTerpilih) {
        const variasiBarang = databaseBarang.filter(i => i.nama === namaTerpilih);
        selectUkuran.innerHTML = variasiBarang.map(item => `<option value="${item.ukuran}">${item.ukuran}</option>`).join('');
        
        const selectJenis = document.getElementById('trans-jenis');
        if (variasiBarang.length > 0 && selectJenis.value !== variasiBarang[0].jenis) {
            selectJenis.value = variasiBarang[0].jenis;
        }
        syncHargaBerdasarkanUkuran();
    } else {
        resetInputDetail();
    }
}

function syncHargaBerdasarkanUkuran() {
    const namaTerpilih = document.getElementById('trans-nama').value;
    const ukuranTerpilih = document.getElementById('trans-ukuran').value;
    const item = databaseBarang.find(i => i.nama === namaTerpilih && i.ukuran === ukuranTerpilih);
    if (item) {
        document.getElementById('trans-harga').value = item.harga.toLocaleString('id-ID');
    }
}

function ubahJumlah(delta) {
    const input = document.getElementById('trans-jumlah');
    let val = parseInt(input.value) || 1;
    val += delta;
    if (val < 1) val = 1; 
    input.value = val;
}

function resetInputDetail() {
    document.getElementById('trans-harga').value = '';
    document.getElementById('trans-ukuran').innerHTML = '<option value="">-</option>';
    document.getElementById('trans-jumlah').value = 1;
}

function tambahkanKeKeranjang() {
    const nama = document.getElementById('trans-nama').value;
    const ukuran = document.getElementById('trans-ukuran').value;
    
    if(!nama) return showToast("Silakan pilih nama barang terlebih dahulu!", "error");

    const itemOriginal = databaseBarang.find(i => i.nama === nama && i.ukuran === ukuran);
    if(!itemOriginal) return showToast("Data barang tidak valid.", "error");

    const harga = parseInt(itemOriginal.harga);
    const jml = parseInt(document.getElementById('trans-jumlah').value) || 1;
    
    if (keranjang.some(k => k.nama === nama && k.ukuran === ukuran)) {
        return showToast("Barang ini sudah ada di keranjang!", "error");
    }

    keranjang.push({ nama, ukuran, harga, jml, subtotal: harga * jml });
    document.getElementById('trans-nama').value = '';
    document.getElementById('trans-jumlah').value = 1;
    resetInputDetail();
    showToast("Barang ditambahkan ke keranjang");
    renderTabelKeranjang();
}

function hapusDariKeranjang(index) {
    keranjang.splice(index, 1);
    renderTabelKeranjang();
}

function renderTabelKeranjang() {
    const tbody = document.getElementById('tabel-keranjang-body');
    
    if (keranjang.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-4 text-center text-gray-400 italic">Keranjang masih kosong</td></tr>';
        document.getElementById('total-item-keranjang').innerText = '0';
        document.getElementById('total-harga-keranjang').innerText = '0';
        return;
    }

    let totalItem = 0, totalHarga = 0;
    let html = '';

    keranjang.forEach((item, index) => {
        totalItem += item.jml;
        totalHarga += item.subtotal;
        html += `
            <tr class="bg-white border-b md:border-b-0 hover:bg-gray-50">
                <td data-label="Barang" class="px-4 py-3 font-medium text-gray-800">${item.nama}</td>
                <td data-label="Ukuran" class="px-4 py-3 text-center">${item.ukuran}</td>
                <td data-label="Harga" class="px-4 py-3 text-right">Rp ${item.harga.toLocaleString('id-ID')}</td>
                <td data-label="Jumlah" class="px-4 py-3 text-center">${item.jml}</td>
                <td data-label="Subtotal" class="px-4 py-3 text-right font-semibold text-blue-600">Rp ${item.subtotal.toLocaleString('id-ID')}</td>
                <td data-label="Aksi" class="px-4 py-3 text-center">
                    <button onclick="hapusDariKeranjang(${index})" class="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-2 rounded">
                        <svg class="w-5 h-5 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    document.getElementById('total-item-keranjang').innerText = totalItem;
    document.getElementById('total-harga-keranjang').innerText = totalHarga.toLocaleString('id-ID');
}

async function prosesBayar() {
    if (keranjang.length === 0) return showToast("Keranjang kosong!", "error");

    const namaPlg = document.getElementById('trans-nama-pelanggan').value || "Umum";
    const wa = document.getElementById('trans-no-wa').value || "-";
    const totalItem = keranjang.reduce((s, i) => s + i.jml, 0);
    const totalHarga = keranjang.reduce((s, i) => s + i.subtotal, 0);

    toggleLoading(true, 'Memproses...');

    const txId = editingTxId || ("TX_" + Date.now());
    const tgl = new Date().toLocaleDateString('id-ID', { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
    
    const currentTx = {
        id: txId, tanggal: tgl, nama: namaPlg, wa: wa, items: [...keranjang], totalItem, totalHarga
    };

    const payload = {
        action: editingTxId ? 'editTransaksi' : 'addTransaksi',
        id: txId,
        nama_pelanggan: namaPlg,
        no_wa: wa,
        detail_pesanan: JSON.stringify(keranjang),
        total_item: totalItem,
        total_harga: totalHarga
    };

    const success = await sendData(payload, "Transaksi Berhasil!");

    if(success) {
        if(editingTxId) {
            const idx = riwayatTransaksi.findIndex(t => t.id === editingTxId);
            if(idx > -1) riwayatTransaksi[idx] = currentTx;
        } else {
            riwayatTransaksi.unshift(currentTx);
        }
        
        updateDropdownRiwayat();
        tampilkanStruk(currentTx);
        switchTab('page-pesanan');
        editingTxId = null;
    }
    
    toggleLoading(false);
}


// ==========================================
// 8. STRUK & RIWAYAT
// ==========================================

function updateDropdownRiwayat() {
    const select = document.getElementById('dropdown-riwayat');
    const areaStruk = document.getElementById('area-struk');
    
    if(riwayatTransaksi.length === 0) {
        select.innerHTML = '<option value="">-- Belum ada riwayat --</option>';
        if (areaStruk) areaStruk.classList.add('hidden'); 
        return;
    }
    
    if (areaStruk) areaStruk.classList.remove('hidden');
    select.innerHTML = riwayatTransaksi.map(tx => 
        `<option value="${tx.id}">${tx.tanggal} - ${tx.nama}</option>`
    ).join('');
}

function gantiRiwayat() {
    const id = document.getElementById('dropdown-riwayat').value;
    const tx = riwayatTransaksi.find(t => t.id === id);
    if(tx) tampilkanStruk(tx);
}

function tampilkanStruk(tx) {
    currentViewedTx = tx;
    document.getElementById('struk-tanggal').innerText = tx.tanggal;
    document.getElementById('rekap-nama').innerText = tx.nama;
    document.getElementById('rekap-wa').innerText = tx.wa;
    document.getElementById('rekap-total-item').innerText = tx.totalItem;
    document.getElementById('rekap-total-harga').innerText = tx.totalHarga.toLocaleString('id-ID');

    const tbody = document.getElementById('tabel-rekap-body');
    let html = '';
    tx.items.forEach((item) => {
        html += `
            <div class="mb-2">
                <div class="font-bold">${item.nama} (${item.ukuran})</div>
                <div class="flex justify-between text-sm">
                    <span>${item.jml} x Rp ${item.harga.toLocaleString('id-ID')}</span>
                    <span>Rp ${item.subtotal.toLocaleString('id-ID')}</span>
                </div>
            </div>
        `;
    });
    tbody.innerHTML = html;
    
    document.getElementById('dropdown-riwayat').value = tx.id;
}

function kirimWhatsApp() {
    if(!currentViewedTx) return showToast("Pilih data pesanan dulu!", "error");

    let { nama, wa, totalHarga, items } = currentViewedTx;
    wa = String(wa).replace(/[^0-9]/g, ''); 
    if (wa.startsWith('0')) wa = '62' + wa.substring(1);
    else if (!wa.startsWith('62')) wa = '62' + wa;

    let pesan = `Halo *${nama}*,\nBerikut rincian pesanan Anda:\n\n`;
    items.forEach((item) => {
        pesan += `${item.nama} (Uk: ${item.ukuran})\n   ${item.jml} x Rp ${item.harga.toLocaleString('id-ID')} = Rp ${item.subtotal.toLocaleString('id-ID')}\n`;
    });
    pesan += `\n==================\n*TOTAL TAGIHAN : Rp ${totalHarga.toLocaleString('id-ID')}*\n==================\n\n`;
    pesan += `Pembayaran dapat dilakukan secara tunai atau transfer\n\nTransfer dapat dilakukan melalui\nSeabank : 901355785479\natau\nShopee pay/gopay : 081357432595\nAtas nama : Ummu Hayatin\n\n*Pastikan konfirmasi dengan mengirimkan bukti pembayaran.*\n\nTerima kasih banyak telah berbelanja, Semoga berkah! 🙏😊`;

    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(pesan)}`, '_blank');
}

function editPesanan() {
    if(!currentViewedTx) return showToast("Pilih data pesanan dulu!", "error");
    editingTxId = currentViewedTx.id;
    document.getElementById('trans-nama-pelanggan').value = currentViewedTx.nama;
    document.getElementById('trans-no-wa').value = currentViewedTx.wa;
    keranjang = JSON.parse(JSON.stringify(currentViewedTx.items));
    renderTabelKeranjang();
    lanjutKePilihBarang(); 
    switchTab('page-transaksi');
    showToast("Mode Edit: Silakan perbarui pesanan", "info");
}

function hapusPesanan() {
    if(!currentViewedTx) return showToast("Pilih data pesanan dulu!", "error");
    if(!confirm(`Yakin ingin MENGHAPUS pesanan atas nama ${currentViewedTx.nama}?`)) return;

    toggleLoading(true, 'Menghapus Pesanan...');
    const formData = new URLSearchParams({ action: 'deleteTransaksi', id: currentViewedTx.id });

    // Gunakan wrapper sendData agar support offline queue (opsional) atau fetch biasa
    fetch(SCRIPT_URL, { method: 'POST', body: formData })
        .then(res => res.text())
        .then(text => {
            toggleLoading(false);
            showToast("Pesanan berhasil dihapus!");
            
            riwayatTransaksi = riwayatTransaksi.filter(t => t.id !== currentViewedTx.id);
            updateDropdownRiwayat();
            
            if(riwayatTransaksi.length > 0) {
                tampilkanStruk(riwayatTransaksi[0]);
            } else {
                currentViewedTx = null;
                document.getElementById('area-struk').classList.add('hidden');
            }
        })
        .catch(err => {
            toggleLoading(false);
            showToast("Gagal menghapus pesanan: " + err.message, "error");
        });
}

function resetSemua() {
    keranjang = [];
    editingTxId = null;
    document.getElementById('trans-nama-pelanggan').value = '';
    document.getElementById('trans-no-wa').value = '';
    renderTabelKeranjang();
    kembaliKePelanggan();
    switchTab('page-transaksi');
}


// ==========================================
// 9. BLUETOOTH PRINTER & A4
// ==========================================

function cetakStrukA4() {
    window.print();
}

async function connectBluetooth() {
    if (!navigator.bluetooth) { 
        alert("Browser tidak support Bluetooth (Gunakan Chrome di Android/PC)."); 
        return; 
    }
    const btnBt = document.getElementById('btn-bt-connect');
    const txtBt = document.getElementById('bt-status-text');

    try {
        if (printerDevice && printerDevice.gatt.connected) printerDevice.gatt.disconnect();
        printerDevice = await navigator.bluetooth.requestDevice({ filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }] });
        printerDevice.addEventListener('gattserverdisconnected', onDisconnected);
        const server = await printerDevice.gatt.connect();
        await new Promise(r => setTimeout(r, 500)); 
        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
        printerCharacteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
        
        btnBt.classList.remove('bg-gray-100', 'text-gray-600');
        btnBt.classList.add('bg-green-600', 'text-white', 'border-green-700');
        txtBt.innerText = "Printer Ready";
        showToast("Printer Berhasil Terhubung!");
    } catch (e) { 
        if (e.name !== 'NotFoundError') alert("Gagal Konek: " + e.message); 
        onDisconnected(); 
    }
}

function onDisconnected() {
    const btnBt = document.getElementById('btn-bt-connect');
    const txtBt = document.getElementById('bt-status-text');
    if(btnBt) {
        btnBt.classList.remove('bg-green-600', 'text-white', 'border-green-700');
        btnBt.classList.add('bg-gray-100', 'text-gray-600');
    }
    if(txtBt) txtBt.innerText = "Printer";
    printerCharacteristic = null;
}

function strToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code > 255) code = 63; 
        bytes.push(code);
    }
    return new Uint8Array(bytes);
}

async function cetakStrukThermal() {
    if (!currentViewedTx) return showToast("Pilih pesanan dulu!", "error");
    if (!printerCharacteristic) {
        if (confirm("Printer belum terhubung. Hubungkan sekarang?")) {
            await connectBluetooth();
            if (!printerCharacteristic) return;
        } else return;
    }
    if (isPrinting) return showToast("Sedang mencetak...", "info");
    isPrinting = true;
    showToast("Mengirim data ke printer...", "info");

    try {
        const tx = currentViewedTx;
        const ESC = '\u001B', GS = '\u001D', init = ESC + '@';
        const center = ESC + 'a' + '\u0001', left = ESC + 'a' + '\u0000';
        const boldOn = ESC + 'E' + '\u0001', boldOff = ESC + 'E' + '\u0000';
        const bigFont = GS + '!' + '\u0011', normalFont = GS + '!' + '\u0000';

        let receiptText = init + center + boldOn + bigFont + "TOKO KAMI" + normalFont + boldOff + "\n" +
            "0812-3456-7890 (WA)\nJl. Contoh Alamat No. 123\n--------------------------------\n" + left + 
            `Tgl : ${tx.tanggal}\nPlg : ${tx.nama}\nWA  : ${tx.wa}\n--------------------------------\n`;

        tx.items.forEach((item) => {
            receiptText += `${boldOn}${item.nama} (${item.ukuran})${boldOff}\n`;
            let detailStr = `  ${item.jml} x Rp ${item.harga.toLocaleString('id-ID')}`;
            let subtotalStr = `Rp ${item.subtotal.toLocaleString('id-ID')}`;
            let spaceCount = Math.max(1, 32 - (detailStr.length + subtotalStr.length));
            receiptText += detailStr + " ".repeat(spaceCount) + subtotalStr + "\n";
        });

        receiptText += "--------------------------------\n" + `Total Item : ${tx.totalItem}\n` +
            boldOn + `TOTAL BAYAR: Rp ${tx.totalHarga.toLocaleString('id-ID')}\n` + boldOff +
            "--------------------------------\n" + center + "Barang yang sudah dibeli\ntidak dapat ditukar/dikembalikan\nTerima Kasih, Semoga Berkah!\n\n\n\n"; 

        let encodedData = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(receiptText) : strToBytes(receiptText);
        const maxChunk = 50; 
        for (let i = 0; i < encodedData.length; i += maxChunk) {
            await printerCharacteristic.writeValue(encodedData.slice(i, i + maxChunk));
            await new Promise(resolve => setTimeout(resolve, 50)); 
        }
        showToast("Selesai mencetak!");
    } catch (error) { 
        showToast("Gagal mencetak. Cek koneksi printer.", "error"); 
        onDisconnected();
    } finally { isPrinting = false; }
}


// ==========================================
// 10. DASHBOARD (FULL FEATURES)
// ==========================================

document.addEventListener('click', function(event) {
    const isClickInsideJenis = event.target.closest('#dropdown-jenis-content') || event.target.closest('button[onclick*="dropdown-jenis-content"]');
    const isClickInsideUkuran = event.target.closest('#dropdown-ukuran-content') || event.target.closest('button[onclick*="dropdown-ukuran-content"]');
    const isClickInsidePelanggan = event.target.closest('#autocomplete-pelanggan') || event.target.closest('#filter-pelanggan');

    if (!isClickInsideJenis) document.getElementById('dropdown-jenis-content')?.classList.add('hidden');
    if (!isClickInsideUkuran) document.getElementById('dropdown-ukuran-content')?.classList.add('hidden');
    if (!isClickInsidePelanggan) document.getElementById('autocomplete-pelanggan')?.classList.add('hidden');
});

function toggleDropdown(id) {
    const dropdown = document.getElementById(id);
    if (dropdown.classList.contains('hidden')) {
        document.getElementById('dropdown-jenis-content').classList.add('hidden');
        document.getElementById('dropdown-ukuran-content').classList.add('hidden');
        document.getElementById('autocomplete-pelanggan').classList.add('hidden');
        dropdown.classList.remove('hidden');
    } else dropdown.classList.add('hidden');
}

async function loadDashboardData() {
    toggleLoading(true, "Mengambil data dashboard...");
    try {
        const url = `${SCRIPT_URL}?action=getDashboardData&v=${new Date().getTime()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Gagal terhubung ke server");
        const result = await response.json();
        if (result.status === 'error') throw new Error(result.message);
        allSoldItems = result.data; 
        populateDashboardFilters();
        applyDashboardFilters();
    } catch (error) { showToast("Gagal memuat dashboard", "error"); } 
    finally { toggleLoading(false); }
}

function populateDashboardFilters() {
    const jenisSet = [...new Set(allSoldItems.map(item => item.jenis))].sort();
    const ukuranSet = [...new Set(allSoldItems.map(item => item.ukuran))].sort();
    uniqueCustomers = [...new Set(allSoldItems.map(item => item.pelanggan))].sort();

    document.getElementById('list-checkbox-jenis').innerHTML = `
        <label class="flex items-center p-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200">
            <input type="checkbox" id="selectAllJenis" onchange="toggleAllJenis(this)" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
            <span class="ml-2 text-sm font-bold text-gray-700">Centang Semua</span>
        </label>` + 
        jenisSet.map(jenis => `
        <label class="flex items-center p-2 hover:bg-blue-50 cursor-pointer rounded">
            <input type="checkbox" value="${jenis}" onchange="updateSelectedJenis(this)" class="chk-jenis w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
            <span class="ml-2 text-sm font-medium text-gray-700">${jenis}</span>
        </label>`).join('');

    document.getElementById('list-checkbox-ukuran').innerHTML = `
        <label class="flex items-center p-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200">
            <input type="checkbox" id="selectAllUkuran" onchange="toggleAllUkuran(this)" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
            <span class="ml-2 text-sm font-bold text-gray-700">Centang Semua</span>
        </label>` + 
        ukuranSet.map(ukuran => `
        <label class="flex items-center p-2 hover:bg-blue-50 cursor-pointer rounded">
            <input type="checkbox" value="${ukuran}" onchange="updateSelectedUkuran(this)" class="chk-ukuran w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
            <span class="ml-2 text-sm font-medium text-gray-700">${ukuran}</span>
        </label>`).join('');
}

function toggleAllJenis(selectAll) {
    document.querySelectorAll('.chk-jenis').forEach(cb => { cb.checked = selectAll.checked; });
    selectedJenis = selectAll.checked ? Array.from(document.querySelectorAll('.chk-jenis')).map(cb => cb.value) : [];
    updateLabelJenis(); applyDashboardFilters();
}

function toggleAllUkuran(selectAll) {
    document.querySelectorAll('.chk-ukuran').forEach(cb => { cb.checked = selectAll.checked; });
    selectedUkuran = selectAll.checked ? Array.from(document.querySelectorAll('.chk-ukuran')).map(cb => cb.value) : [];
    updateLabelUkuran(); applyDashboardFilters();
}

function updateSelectedJenis(checkbox) {
    if (checkbox.checked) selectedJenis.push(checkbox.value);
    else selectedJenis = selectedJenis.filter(v => v !== checkbox.value);
    document.getElementById('selectAllJenis').checked = (selectedJenis.length === document.querySelectorAll('.chk-jenis').length);
    updateLabelJenis(); applyDashboardFilters();
}

function updateSelectedUkuran(checkbox) {
    if (checkbox.checked) selectedUkuran.push(checkbox.value);
    else selectedUkuran = selectedUkuran.filter(v => v !== checkbox.value);
    document.getElementById('selectAllUkuran').checked = (selectedUkuran.length === document.querySelectorAll('.chk-ukuran').length);
    updateLabelUkuran(); applyDashboardFilters();
}

function updateLabelJenis() {
    const label = document.getElementById('label-jenis');
    if (selectedJenis.length === 0) label.innerText = "Semua Jenis";
    else if (selectedJenis.length === 1) label.innerText = selectedJenis[0];
    else label.innerText = `${selectedJenis.length} Jenis Dipilih`;
}

function updateLabelUkuran() {
    const label = document.getElementById('label-ukuran');
    if (selectedUkuran.length === 0) label.innerText = "Semua Ukuran";
    else if (selectedUkuran.length === 1) label.innerText = selectedUkuran[0];
    else label.innerText = `${selectedUkuran.length} Ukuran Dipilih`;
}

function handleCustomerSearch(event) {
    const val = event.target.value.toLowerCase();
    const div = document.getElementById('autocomplete-pelanggan');
    const ul = document.getElementById('list-saran-pelanggan');
    
    const suggestions = uniqueCustomers.filter(name => name.toLowerCase().includes(val));
    
    if (suggestions.length === 0) {
        div.classList.add('hidden');
        applyDashboardFilters(); 
        return;
    }

    ul.innerHTML = suggestions.map(name => `
        <li onclick="selectCustomer('${name.replace(/'/g, "\\'")}')" class="px-4 py-2 hover:bg-blue-50 cursor-pointer text-gray-700 border-b border-gray-100 last:border-0">
            ${name}
        </li>
    `).join('');
    
    div.classList.remove('hidden');
    applyDashboardFilters(); 
}

function selectCustomer(name) {
    document.getElementById('filter-pelanggan').value = name;
    document.getElementById('autocomplete-pelanggan').classList.add('hidden');
    applyDashboardFilters();
}

function applyDashboardFilters() {
    const pValue = document.getElementById('filter-pelanggan').value.toLowerCase();

    let filtered = allSoldItems.filter(item => {
        const jenisMatch = selectedJenis.length === 0 || selectedJenis.includes(item.jenis);
        const ukuranMatch = selectedUkuran.length === 0 || selectedUkuran.includes(item.ukuran);
        const pelangganMatch = !pValue || item.pelanggan.toLowerCase().includes(pValue);
        
        return jenisMatch && ukuranMatch && pelangganMatch;
    });

    const summary = {
        totalPendapatan: 0, totalBarang: 0, produkTerlaris: '-',
        penjualanPerJenis: {}, penjualanPerProduk: {}, transaksi: new Set() 
    };

    filtered.forEach(item => {
        summary.totalPendapatan += item.subtotal;
        summary.totalBarang += item.jml;
        summary.penjualanPerJenis[item.jenis] = (summary.penjualanPerJenis[item.jenis] || 0) + item.subtotal;
        summary.penjualanPerProduk[item.nama] = (summary.penjualanPerProduk[item.nama] || 0) + item.jml;
        summary.transaksi.add(item.pelanggan);
    });
    
    summary.totalTransaksi = summary.transaksi.size;
    const sorted = Object.entries(summary.penjualanPerProduk).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) summary.produkTerlaris = sorted[0][0];
    
    renderDashboard(summary);
}

function resetDashboardFilters() {
    selectedJenis = [];
    selectedUkuran = [];
    
    document.querySelectorAll('.chk-jenis').forEach(cb => cb.checked = false);
    document.querySelectorAll('.chk-ukuran').forEach(cb => cb.checked = false);
    document.getElementById('selectAllJenis').checked = false;
    document.getElementById('selectAllUkuran').checked = false;
    
    updateLabelJenis();
    updateLabelUkuran();
    document.getElementById('filter-pelanggan').value = '';
    document.getElementById('autocomplete-pelanggan').classList.add('hidden');

    applyDashboardFilters();
}

function renderDashboard(summary) {
    document.getElementById('db-total-pendapatan').textContent = `Rp ${summary.totalPendapatan.toLocaleString('id-ID')}`;
    document.getElementById('db-total-barang').textContent = summary.totalBarang.toLocaleString('id-ID');
    document.getElementById('db-total-transaksi').textContent = summary.totalTransaksi.toLocaleString('id-ID');
    document.getElementById('db-produk-terlaris').textContent = summary.produkTerlaris;
    
    renderChartJenis(summary.penjualanPerJenis);
    renderChartTopProduk(summary.penjualanPerProduk);
}

function getRandomColor() {
    const r = Math.floor(Math.random() * 200);
    const g = Math.floor(Math.random() * 200);
    const b = Math.floor(Math.random() * 200);
    return `rgba(${r}, ${g}, ${b}, 0.7)`;
}

function renderChartJenis(data) {
    const ctx = document.getElementById('chart-jenis-barang').getContext('2d');
    const labels = Object.keys(data);
    const values = Object.values(data);
    const colors = labels.map(() => getRandomColor());

    if (chartJenisBarang) {
        chartJenisBarang.data.labels = labels;
        chartJenisBarang.data.datasets[0].data = values;
        chartJenisBarang.data.datasets[0].backgroundColor = colors;
        chartJenisBarang.update();
    } else {
        chartJenisBarang = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Pendapatan',
                    data: values,
                    backgroundColor: colors,
                    borderColor: '#fff',
                    borderWidth: 2
                }]
            },
            options: { responsive: true, maintainAspectRatio: true }
        });
    }
}

function renderChartTopProduk(data) {
    const ctx = document.getElementById('chart-top-produk').getContext('2d');
    const sortedProduk = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 5);
    
    const labels = sortedProduk.map(item => item[0]);
    const values = sortedProduk.map(item => item[1]);
    const colors = labels.map(() => getRandomColor());

    if (chartTopProduk) {
        chartTopProduk.data.labels = labels;
        chartTopProduk.data.datasets[0].data = values;
        chartTopProduk.data.datasets[0].backgroundColor = colors;
        chartTopProduk.update();
    } else {
        chartTopProduk = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Jumlah Terjual',
                    data: values,
                    backgroundColor: colors,
                    borderColor: colors.map(c => c.replace('0.7', '1')),
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y', 
                responsive: true,
                plugins: { legend: { display: false } }
            }
        });
    }
}


// ==========================================
// 11. MANAJEMEN PENGGUNA (KHUSUS ADMIN)
// ==========================================

async function loadUsers() {
    toggleLoading(true, "Memuat data pengguna...");
    try {
        const url = `${SCRIPT_URL}?action=getUsers&v=${new Date().getTime()}`;
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.status === 'error') throw new Error(result.message);
        
        const tbody = document.getElementById('tabel-users-body');
        tbody.innerHTML = result.data.map(u => `
            <tr class="bg-white border-b hover:bg-gray-50 md:border-b-0">
                <td data-label="Username" class="px-4 py-2 font-medium">${u.username}</td>
                <td data-label="Role" class="px-4 py-2"><span class="px-2 py-1 rounded text-xs font-bold ${u.role==='admin'?'bg-purple-100 text-purple-700':'bg-green-100 text-green-700'}">${u.role.toUpperCase()}</span></td>
                <td data-label="Aksi" class="px-4 py-2 text-center">
                    <button onclick="editUser('${u.username}', '${u.role}')" class="text-blue-600 hover:text-blue-800 mr-2">Edit</button>
                    <button onclick="deleteUser('${u.username}')" class="text-red-600 hover:text-red-800">Hapus</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        showToast("Gagal memuat users: " + e.message, "error");
    } finally {
        toggleLoading(false);
    }
}

async function submitUser(e) {
    e.preventDefault();
    if(!navigator.onLine) return showToast("Kelola User wajib Online!", "error");

    const username = document.getElementById('user-username').value.trim();
    const passwordRaw = document.getElementById('user-password').value.trim();
    const role = document.getElementById('user-role').value;
    const originalUsername = document.getElementById('user-original-username').value;

    if (!username) return showToast("Username wajib diisi!", "error");
    if (!originalUsername && !passwordRaw) return showToast("Password wajib untuk user baru!", "error");

    toggleLoading(true, "Menyimpan data...");
    
    try {
        const formData = new URLSearchParams();
        formData.append('action', 'saveUser');
        formData.append('username', username);
        formData.append('role', role);
        if (originalUsername) formData.append('originalUsername', originalUsername);
        
        if (passwordRaw) {
            const hashed = await hashPassword(passwordRaw);
            formData.append('password', hashed);
        }

        const response = await fetch(SCRIPT_URL, { method: 'POST', body: formData });
        const text = await response.text();
        
        if (text.includes("tersimpan") || text.includes("diperbarui") || text.includes("ditambahkan")) {
            showToast(text);
            resetFormUser();
            loadUsers();
        } else {
            showToast("Gagal: " + text, "error");
        }
    } catch (e) {
        showToast("Error: " + e.message, "error");
    } finally {
        toggleLoading(false);
    }
}

function editUser(username, role) {
    document.getElementById('user-username').value = username;
    document.getElementById('user-role').value = role;
    document.getElementById('user-original-username').value = username; 
    document.getElementById('user-password').placeholder = "Kosongkan jika password tetap";
    document.getElementById('user-password').value = "";
    document.getElementById('user-username').focus();
}

function resetFormUser() {
    document.getElementById('form-user').reset();
    document.getElementById('user-original-username').value = "";
    document.getElementById('user-password').placeholder = "Isi untuk reset password";
}

async function deleteUser(username) {
    if(!navigator.onLine) return showToast("Wajib Online!", "error");
    if (!confirm(`Hapus pengguna "${username}"?`)) return;
    
    toggleLoading(true, "Menghapus...");
    const formData = new URLSearchParams();
    formData.append('action', 'deleteUser');
    formData.append('username', username);
    
    try {
        await fetch(SCRIPT_URL, { method: 'POST', body: formData });
        showToast("Pengguna dihapus");
        loadUsers();
    } catch (e) {
        showToast("Gagal hapus: " + e.message, "error");
    } finally {
        toggleLoading(false);
    }
}

// --- UTILS: FULL SCREEN ---
function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((e) => {
            console.log(e);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}
