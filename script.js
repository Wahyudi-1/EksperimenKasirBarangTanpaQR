// --- KONFIGURASI URL APPS SCRIPT ---
// PENTING: Ganti URL di bawah ini dengan URL Web App (Exec) terbaru Anda!
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzX_vVW7xQFa1PkDqSPl9UFgUEZMMiisd12q8NNVDSEhdeXBN90y9vkDb0D49jwuhsxyQ/exec';

// --- STATE APLIKASI ---
let databaseBarang = [];
let keranjang = [];
let jenisUnik = [];
let riwayatTransaksi = []; 
let currentViewedTx = null;
let editingTxId = null;

// --- STATE DASHBOARD ---
let allSoldItems = []; 
let chartJenisBarang, chartTopProduk; 
let selectedJenis = [];
let selectedUkuran = [];
let uniqueCustomers = []; 

// --- INISIALISASI ---
window.onload = () => {
    switchTab('page-input');
    loadDatabase();
};

// --- SISTEM NOTIFIKASI TOAST ---
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

// --- NAVIGASI TAB ---
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

    // Load data dashboard saat tab diklik pertama kali
    if (pageId === 'page-dashboard' && allSoldItems.length === 0) {
        loadDashboardData();
    }
}

// --- KOMUNIKASI DATABASE ---
async function loadDatabase() {
    toggleLoading(true, 'Mengunduh Data Database...');
    try {
        const urlWithCacheBuster = SCRIPT_URL + '?v=' + new Date().getTime();
        const response = await fetch(urlWithCacheBuster);
        
        if(!response.ok) {
            throw new Error(`Koneksi Gagal: ${response.status} ${response.statusText}`);
        }
        
        const rawText = await response.text();

        if (!rawText || rawText.trim() === "") {
            throw new Error("Server mengembalikan respon kosong. Pastikan Anda melakukan 'New Deployment' dan tidak ada error di script.");
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (jsonError) {
            if (rawText.includes("<!DOCTYPE html>")) {
                throw new Error("Terblokir CORS/Otentikasi. Pastikan akses Deployment adalah 'Anyone'.");
            }
            throw new Error("Format data dari server bukan JSON yang valid. Cek Console untuk detail.");
        }
        
        if (data.status === 'error') {
            throw new Error(data.message || "Terjadi kesalahan pada Server Apps Script.");
        }
        
        if (Array.isArray(data)) {
            databaseBarang = data;
        } else {
            databaseBarang = data.barang || [];
            riwayatTransaksi = data.pesanan || [];
        }
        
        if (databaseBarang.length === 0) {
            showToast("Koneksi Berhasil, tapi Data Barang di Spreadsheet Kosong.", "info");
        } else {
            showToast(`Berhasil memuat ${databaseBarang.length} data barang.`);
        }

        jenisUnik = [...new Set(databaseBarang.map(item => item.jenis).filter(Boolean))];
        updateDropdownJenis();
        updateDropdownNamaSemua();
        updateDropdownRiwayat();
        
        if(riwayatTransaksi.length > 0) {
            tampilkanStruk(riwayatTransaksi[0]);
        }
        
    } catch (error) {
        console.error("Load DB Error:", error);
        showToast(error.message, "error");
    } finally {
        toggleLoading(false);
    }
}


// --- HALAMAN 1: INPUT BARANG ---
function submitBarang(e) {
    e.preventDefault();
    
    const jenisInput = document.getElementById('input-jenis').value.trim();
    const namaInput = document.getElementById('input-nama').value.trim();
    const hargaInput = document.getElementById('input-harga').value;
    const ukuranInput = document.getElementById('input-ukuran').value.trim();

    const existingItem = databaseBarang.find(item => 
        item.jenis.toLowerCase() === jenisInput.toLowerCase() &&
        item.nama.toLowerCase() === namaInput.toLowerCase() &&
        item.ukuran.toLowerCase() === ukuranInput.toLowerCase()
    );

    let actionType = 'addBarang';

    if (existingItem) {
        const isConfirmed = confirm(`Data barang sudah tersedia (Harga saat ini: Rp ${existingItem.harga.toLocaleString('id-ID')}).\nApakah Anda ingin memperbarui harga barang menjadi Rp ${parseInt(hargaInput).toLocaleString('id-ID')}?`);
        if (!isConfirmed) return; 
        actionType = 'editBarang'; 
    }

    toggleLoading(true, existingItem ? 'Memperbarui Harga Barang...' : 'Menyimpan Barang...');

    const formData = new URLSearchParams();
    formData.append('action', actionType);
    formData.append('jenis', jenisInput);
    formData.append('nama', namaInput);
    formData.append('harga', hargaInput);
    formData.append('ukuran', ukuranInput);

    fetch(SCRIPT_URL, { method: 'POST', body: formData })
        .then(res => res.text())
        .then(text => {
            if (text.toLowerCase().includes("error")) throw new Error(text);
            
            showToast(existingItem ? "Harga barang berhasil diperbarui!" : "Barang berhasil ditambahkan!");
            document.getElementById('form-barang').reset();
            loadDatabase();
        })
        .catch(err => {
            showToast("Gagal menyimpan: " + err.message, "error");
            toggleLoading(false);
        });
}


// --- HALAMAN 2: TRANSAKSI (LOGIKA DROPDOWN & KERANJANG) ---
function lanjutKePilihBarang() {
    const nama = document.getElementById('trans-nama-pelanggan').value.trim();
    const wa = document.getElementById('trans-no-wa').value.trim();
    
    if(!nama || !wa) {
        showToast("Nama dan No WhatsApp wajib diisi!", "error");
        return;
    }

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

    let items = databaseBarang;
    if (filterJenis) {
        items = databaseBarang.filter(item => item.jenis === filterJenis);
    }
    
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
    const namaSelect = document.getElementById('trans-nama');
    const nama = namaSelect.value;
    const ukuran = document.getElementById('trans-ukuran').value;
    
    if(!nama) return showToast("Silakan pilih nama barang terlebih dahulu!", "error");

    const itemOriginal = databaseBarang.find(i => i.nama === nama && i.ukuran === ukuran);
    if(!itemOriginal) return showToast("Data barang tidak valid.", "error");

    const harga = parseInt(itemOriginal.harga);
    const jml = parseInt(document.getElementById('trans-jumlah').value) || 1;
    
    const indexAda = keranjang.findIndex(k => k.nama === nama && k.ukuran === ukuran);
    if(indexAda > -1) {
        return showToast("Barang dengan ukuran tersebut sudah ada di keranjang!", "error");
    } else {
        keranjang.push({ 
            nama: nama, 
            ukuran: ukuran, 
            harga: harga, 
            jml: jml, 
            subtotal: harga * jml 
        });
    }

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

    let html = '';
    let totalItem = 0;
    let totalHarga = 0;

    keranjang.forEach((item, index) => {
        totalItem += item.jml;
        totalHarga += item.subtotal;
        
        // Atribut data-label ditambahkan untuk tampilan Mobile
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

function prosesBayar() {
    if (keranjang.length === 0) return showToast("Keranjang kosong! Tambahkan barang dulu.", "error");

    const namaPelanggan = document.getElementById('trans-nama-pelanggan').value;
    const noWa = document.getElementById('trans-no-wa').value;
    const totalItem = keranjang.reduce((sum, item) => sum + item.jml, 0);
    const totalHarga = keranjang.reduce((sum, item) => sum + item.subtotal, 0);

    toggleLoading(true, 'Memproses Pembayaran...');

    const actionType = editingTxId ? 'editTransaksi' : 'addTransaksi';
    const txId = editingTxId || ("TX_" + Date.now().toString());
    const opsiTanggal = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    
    const currentTx = {
        id: txId,
        tanggal: editingTxId && currentViewedTx ? currentViewedTx.tanggal : new Date().toLocaleDateString('id-ID', opsiTanggal), 
        nama: namaPelanggan,
        wa: noWa,
        items: [...keranjang],
        totalItem: totalItem,
        totalHarga: totalHarga
    };

    const formData = new URLSearchParams();
    formData.append('action', actionType);
    formData.append('id', txId);
    formData.append('nama_pelanggan', namaPelanggan);
    formData.append('no_wa', noWa);
    formData.append('detail_pesanan', JSON.stringify(keranjang));
    formData.append('total_item', totalItem);
    formData.append('total_harga', totalHarga);

    fetch(SCRIPT_URL, { method: 'POST', body: formData })
        .then(res => res.text())
        .then(text => {
            toggleLoading(false);
            
            if (text.includes("ID tidak ditemukan") || (actionType === 'editTransaksi' && !text.includes("diperbarui"))) {
                let errorMsg = text.includes("ID tidak ditemukan") 
                    ? "Gagal: Pesanan lama ini belum memiliki ID di Spreadsheet." 
                    : "Gagal: Respon server tidak valid.";
                showToast(errorMsg, "error");
                loadDatabase(); 
                return;
            }

            if(editingTxId) {
                const index = riwayatTransaksi.findIndex(t => t.id === editingTxId);
                if(index > -1) riwayatTransaksi[index] = currentTx;
            } else {
                riwayatTransaksi.unshift(currentTx);
            }
            updateDropdownRiwayat();

            showToast(editingTxId ? "Pesanan Berhasil Diperbarui!" : "Transaksi Berhasil Disimpan!");
            tampilkanStruk(currentTx);
            switchTab('page-pesanan');
            editingTxId = null; 
        })
        .catch(err => {
            toggleLoading(false);
            showToast("Gagal menyimpan transaksi: " + err.message, "error");
        });
}


// --- HALAMAN 3: STRUK & REKAP ---
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

    const containerItems = document.getElementById('tabel-rekap-body');
    let html = '';
    
    // Render item dengan gaya Thermal (Nama di atas, Harga di bawah)
    tx.items.forEach((item) => {
        html += `
            <div class="mb-2">
                <!-- Baris Atas: Nama Barang & Ukuran -->
                <div class="font-bold">${item.nama} (${item.ukuran})</div>
                
                <!-- Baris Bawah: Qty x Harga = Subtotal (Kanan Kiri) -->
                <div class="flex justify-between text-sm">
                    <span>${item.jml} x ${item.harga.toLocaleString('id-ID')}</span>
                    <span>${item.subtotal.toLocaleString('id-ID')}</span>
                </div>
            </div>
        `;
    });
    
    containerItems.innerHTML = html;
    
    document.getElementById('dropdown-riwayat').value = tx.id;
}

function kirimWhatsApp() {
    if(!currentViewedTx) return showToast("Tidak ada data pesanan yang dipilih!", "error");

    let nama = currentViewedTx.nama;
    let wa = String(currentViewedTx.wa); 
    let totalHarga = currentViewedTx.totalHarga.toLocaleString('id-ID');
    
    wa = wa.replace(/[^0-9]/g, ''); 
    if (wa.startsWith('0')) {
        wa = '62' + wa.substring(1);
    } else if (!wa.startsWith('62')) {
        wa = '62' + wa;
    }

    let pesan = `Halo *${nama}*,\nBerikut adalah rincian pesanan Anda dari toko kami:\n\n`;
    currentViewedTx.items.forEach((item, index) => {
        pesan += `${index+1}. ${item.nama} (Uk: ${item.ukuran})\n   ${item.jml} x Rp ${item.harga.toLocaleString('id-ID')} = Rp ${item.subtotal.toLocaleString('id-ID')}\n`;
    });
    pesan += `\n==================\n`;
    pesan += `*TOTAL TAGIHAN : Rp ${totalHarga}*\n`;
    pesan += `==================\n\n`;
    pesan += `Pembayaran dapat dilakukan secara tunai atau transfer\n\n`;
    pesan += `Transfer dapat dilakukan melalui\n`;
    pesan += `Seabank : 901355785479\n`;
    pesan += `atau\n`;
    pesan += `Shopee pay/gopay : 081357432595\n`;
    pesan += `Atas nama : Ummu Hayatin\n\n`;
    pesan += `*Pastikan konfirmasi dengan mengirimkan bukti pembayaran.*\n\n`;
    pesan += `Terima kasih banyak telah berbelanja, Semoga berkah! 🙏😊`;

    const url = `https://wa.me/${wa}?text=${encodeURIComponent(pesan)}`;
    window.open(url, '_blank');
}

function editPesanan() {
    if(!currentViewedTx) return showToast("Tidak ada data pesanan yang dipilih!", "error");
    
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
    if(!currentViewedTx) return showToast("Tidak ada data pesanan yang dipilih!", "error");
    
    if(!confirm(`Apakah Anda yakin ingin MEMBATALKAN dan MENGHAPUS pesanan atas nama ${currentViewedTx.nama}?`)) {
        return;
    }

    const txId = currentViewedTx.id;
    toggleLoading(true, 'Menghapus Pesanan...');

    const formData = new URLSearchParams();
    formData.append('action', 'deleteTransaksi');
    formData.append('id', txId);

    fetch(SCRIPT_URL, { method: 'POST', body: formData })
        .then(res => res.text())
        .then(text => {
            toggleLoading(false);
            showToast("Pesanan berhasil dihapus!");
            
            riwayatTransaksi = riwayatTransaksi.filter(t => t.id !== txId);
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

// =========================================================================
// --- HALAMAN 4: FUNGSI DASHBOARD (DENGAN SELECT ALL) ---
// =========================================================================

// Menutup dropdown jika user klik di luar area
document.addEventListener('click', function(event) {
    const isClickInsideJenis = event.target.closest('#dropdown-jenis-content') || event.target.closest('button[onclick*="dropdown-jenis-content"]');
    const isClickInsideUkuran = event.target.closest('#dropdown-ukuran-content') || event.target.closest('button[onclick*="dropdown-ukuran-content"]');
    const isClickInsidePelanggan = event.target.closest('#autocomplete-pelanggan') || event.target.closest('#filter-pelanggan');

    if (!isClickInsideJenis) document.getElementById('dropdown-jenis-content')?.classList.add('hidden');
    if (!isClickInsideUkuran) document.getElementById('dropdown-ukuran-content')?.classList.add('hidden');
    if (!isClickInsidePelanggan) document.getElementById('autocomplete-pelanggan')?.classList.add('hidden');
});

// Fungsi buka/tutup dropdown checkbox
function toggleDropdown(id) {
    const dropdown = document.getElementById(id);
    if (dropdown.classList.contains('hidden')) {
        // Tutup yang lain dulu
        document.getElementById('dropdown-jenis-content').classList.add('hidden');
        document.getElementById('dropdown-ukuran-content').classList.add('hidden');
        document.getElementById('autocomplete-pelanggan').classList.add('hidden');
        dropdown.classList.remove('hidden');
    } else {
        dropdown.classList.add('hidden');
    }
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

    } catch (error) {
        showToast("Gagal memuat dashboard: " + error.message, "error");
    } finally {
        toggleLoading(false);
    }
}

function populateDashboardFilters() {
    // 1. Ambil data unik
    const jenisSet = [...new Set(allSoldItems.map(item => item.jenis))].sort();
    const ukuranSet = [...new Set(allSoldItems.map(item => item.ukuran))].sort();
    uniqueCustomers = [...new Set(allSoldItems.map(item => item.pelanggan))].sort();

    // 2. Render Checkbox Jenis (Dengan opsi Select All)
    const listJenis = document.getElementById('list-checkbox-jenis');
    let htmlJenis = `
        <label class="flex items-center p-2 hover:bg-gray-100 cursor-pointer rounded border-b border-gray-200">
            <input type="checkbox" id="selectAllJenis" onchange="toggleAllJenis(this)" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
            <span class="ml-2 text-sm font-bold text-gray-800">Centang Semua</span>
        </label>
    `;
    htmlJenis += jenisSet.map(jenis => `
        <label class="flex items-center p-2 hover:bg-blue-50 cursor-pointer rounded">
            <input type="checkbox" value="${jenis}" onchange="updateSelectedJenis(this)" class="chk-jenis w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
            <span class="ml-2 text-sm font-medium text-gray-700">${jenis}</span>
        </label>
    `).join('');
    listJenis.innerHTML = htmlJenis;

    // 3. Render Checkbox Ukuran (Dengan opsi Select All)
    const listUkuran = document.getElementById('list-checkbox-ukuran');
    let htmlUkuran = `
        <label class="flex items-center p-2 hover:bg-gray-100 cursor-pointer rounded border-b border-gray-200">
            <input type="checkbox" id="selectAllUkuran" onchange="toggleAllUkuran(this)" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
            <span class="ml-2 text-sm font-bold text-gray-800">Centang Semua</span>
        </label>
    `;
    htmlUkuran += ukuranSet.map(ukuran => `
        <label class="flex items-center p-2 hover:bg-blue-50 cursor-pointer rounded">
            <input type="checkbox" value="${ukuran}" onchange="updateSelectedUkuran(this)" class="chk-ukuran w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
            <span class="ml-2 text-sm font-medium text-gray-700">${ukuran}</span>
        </label>
    `).join('');
    listUkuran.innerHTML = htmlUkuran;
}

// Handler Centang Semua Jenis
function toggleAllJenis(selectAllCheckbox) {
    const checkboxes = document.querySelectorAll('.chk-jenis');
    selectedJenis = [];
    
    checkboxes.forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
        if (selectAllCheckbox.checked) {
            selectedJenis.push(cb.value);
        }
    });
    
    updateLabelJenis();
    applyDashboardFilters();
}

// Handler Centang Semua Ukuran
function toggleAllUkuran(selectAllCheckbox) {
    const checkboxes = document.querySelectorAll('.chk-ukuran');
    selectedUkuran = [];
    
    checkboxes.forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
        if (selectAllCheckbox.checked) {
            selectedUkuran.push(cb.value);
        }
    });
    
    updateLabelUkuran();
    applyDashboardFilters();
}

// Handler saat checkbox individual ditekan
function updateSelectedJenis(checkbox) {
    if (checkbox.checked) selectedJenis.push(checkbox.value);
    else selectedJenis = selectedJenis.filter(v => v !== checkbox.value);
    
    // Uncheck 'Select All' jika ada yang di-uncheck
    const selectAllCb = document.getElementById('selectAllJenis');
    const allCheckboxes = document.querySelectorAll('.chk-jenis');
    selectAllCb.checked = (selectedJenis.length === allCheckboxes.length);

    updateLabelJenis();
    applyDashboardFilters();
}

function updateSelectedUkuran(checkbox) {
    if (checkbox.checked) selectedUkuran.push(checkbox.value);
    else selectedUkuran = selectedUkuran.filter(v => v !== checkbox.value);
    
    // Uncheck 'Select All' jika ada yang di-uncheck
    const selectAllCb = document.getElementById('selectAllUkuran');
    const allCheckboxes = document.querySelectorAll('.chk-ukuran');
    selectAllCb.checked = (selectedUkuran.length === allCheckboxes.length);

    updateLabelUkuran();
    applyDashboardFilters();
}

// Fungsi bantu update label tombol
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

// Handler untuk Autocomplete Nama Pelanggan
function handleCustomerSearch(event) {
    const inputVal = event.target.value.toLowerCase();
    const autocompleteDiv = document.getElementById('autocomplete-pelanggan');
    const ul = document.getElementById('list-saran-pelanggan');
    
    const suggestions = uniqueCustomers.filter(name => name.toLowerCase().includes(inputVal));
    
    if (suggestions.length === 0) {
        autocompleteDiv.classList.add('hidden');
        applyDashboardFilters(); 
        return;
    }

    ul.innerHTML = suggestions.map(name => `
        <li onclick="selectCustomer('${name.replace(/'/g, "\\'")}')" class="px-4 py-2 hover:bg-blue-50 cursor-pointer text-gray-700 border-b border-gray-100 last:border-0">
            ${name}
        </li>
    `).join('');
    
    autocompleteDiv.classList.remove('hidden');
    applyDashboardFilters(); 
}

function selectCustomer(name) {
    document.getElementById('filter-pelanggan').value = name;
    document.getElementById('autocomplete-pelanggan').classList.add('hidden');
    applyDashboardFilters();
}

function applyDashboardFilters() {
    const pelangganValue = document.getElementById('filter-pelanggan').value.toLowerCase();

    let filteredItems = allSoldItems.filter(item => {
        const jenisMatch = selectedJenis.length === 0 || selectedJenis.includes(item.jenis);
        const ukuranMatch = selectedUkuran.length === 0 || selectedUkuran.includes(item.ukuran);
        const pelangganMatch = !pelangganValue || item.pelanggan.toLowerCase().includes(pelangganValue);
        
        return jenisMatch && ukuranMatch && pelangganMatch;
    });

    const summary = {
        totalPendapatan: 0, totalBarang: 0, produkTerlaris: '-',
        penjualanPerJenis: {}, penjualanPerProduk: {}, transaksi: new Set() 
    };

    filteredItems.forEach(item => {
        summary.totalPendapatan += item.subtotal;
        summary.totalBarang += item.jml;
        summary.penjualanPerJenis[item.jenis] = (summary.penjualanPerJenis[item.jenis] || 0) + item.subtotal;
        summary.penjualanPerProduk[item.nama] = (summary.penjualanPerProduk[item.nama] || 0) + item.jml;
        summary.transaksi.add(item.pelanggan);
    });
    
    summary.totalTransaksi = summary.transaksi.size;
    const sortedProduk = Object.entries(summary.penjualanPerProduk).sort((a, b) => b[1] - a[1]);
    if (sortedProduk.length > 0) summary.produkTerlaris = sortedProduk[0][0];
    
    renderDashboard(summary);
}

function resetDashboardFilters() {
    selectedJenis = [];
    selectedUkuran = [];
    
    document.querySelectorAll('#list-checkbox-jenis input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#list-checkbox-ukuran input[type="checkbox"]').forEach(cb => cb.checked = false);
    
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
    const r = Math.floor(Math.random() * 200); const g = Math.floor(Math.random() * 200); const b = Math.floor(Math.random() * 200);
    return `rgba(${r}, ${g}, ${b}, 0.7)`;
}

function renderChartJenis(data) {
    const ctx = document.getElementById('chart-jenis-barang').getContext('2d');
    const labels = Object.keys(data); const values = Object.values(data);
    const colors = labels.map(() => getRandomColor());

    if (chartJenisBarang) {
        chartJenisBarang.data.labels = labels;
        chartJenisBarang.data.datasets[0].data = values;
        chartJenisBarang.data.datasets[0].backgroundColor = colors;
        chartJenisBarang.update();
    } else {
        chartJenisBarang = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: labels, datasets: [{ label: 'Pendapatan', data: values, backgroundColor: colors, borderColor: '#fff', borderWidth: 2 }] },
            options: { responsive: true, maintainAspectRatio: true }
        });
    }
}

function renderChartTopProduk(data) {
    const ctx = document.getElementById('chart-top-produk').getContext('2d');
    const sortedProduk = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const labels = sortedProduk.map(item => item[0]); const values = sortedProduk.map(item => item[1]);
    const colors = labels.map(() => getRandomColor());

    if (chartTopProduk) {
        chartTopProduk.data.labels = labels;
        chartTopProduk.data.datasets[0].data = values;
        chartTopProduk.data.datasets[0].backgroundColor = colors;
        chartTopProduk.update();
    } else {
        chartTopProduk = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels, datasets: [{ label: 'Jumlah Terjual', data: values, backgroundColor: colors, borderColor: colors.map(c => c.replace('0.7', '1')), borderWidth: 1 }] },
            options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
        });
    }
}

// =========================================================================
// --- SISTEM CETAK PRINTER THERMAL (BLUETOOTH WEB API) ---
// =========================================================================

// Variabel State Printer
let printerDevice = null;
let printerCharacteristic = null;
let isPrinting = false;

// 1. Fungsi Koneksi Bluetooth
async function connectBluetooth() {
    if (!navigator.bluetooth) { 
        alert("Browser/Perangkat ini tidak mendukung koneksi Bluetooth Web API. Gunakan Chrome di Android/PC."); 
        return; 
    }
    
    const btnBt = document.getElementById('btn-bt-connect');
    const txtBt = document.getElementById('bt-status-text');

    try {
        if (printerDevice && printerDevice.gatt.connected) {
            printerDevice.gatt.disconnect();
        }
        
        // Meminta user memilih printer Bluetooth (Standar service printer generic)
        printerDevice = await navigator.bluetooth.requestDevice({ 
            filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }] 
        });
        
        printerDevice.addEventListener('gattserverdisconnected', onDisconnected);
        const server = await printerDevice.gatt.connect();
        
        await new Promise(r => setTimeout(r, 500)); // Jeda sedikit agar stabil
        
        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
        printerCharacteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
        
        // Update UI Tombol
        btnBt.classList.remove('bg-gray-100', 'text-gray-600');
        btnBt.classList.add('bg-green-600', 'text-white', 'border-green-700');
        txtBt.innerText = "Printer Ready";
        showToast("Printer Thermal Berhasil Terhubung!");
        
    } catch (e) { 
        console.error(e);
        if (e.name !== 'NotFoundError') { // Abaikan jika user sekadar klik cancel
            alert("Gagal Konek: " + e.message); 
        }
        onDisconnected(); 
    }
}

function onDisconnected() {
    const btnBt = document.getElementById('btn-bt-connect');
    const txtBt = document.getElementById('bt-status-text');
    
    btnBt.classList.remove('bg-green-600', 'text-white', 'border-green-700');
    btnBt.classList.add('bg-gray-100', 'text-gray-600');
    txtBt.innerText = "Printer";
    printerCharacteristic = null;
}

function strToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code > 255) code = 63; // Replace karakter aneh dengan '?'
        bytes.push(code);
    }
    return new Uint8Array(bytes);
}

// 2. Fungsi Cetak Format ESC/POS
async function cetakStrukThermal() {
    if (!currentViewedTx) return showToast("Tidak ada pesanan yang dipilih!", "error");
    
    if (!printerCharacteristic) {
        const confirmConnect = confirm("Printer belum terhubung. Hubungkan Bluetooth sekarang?");
        if (confirmConnect) {
            await connectBluetooth();
            if (!printerCharacteristic) return; // Batal jika gagal konek
        } else {
            return;
        }
    }

    if (isPrinting) return showToast("Sedang mencetak, mohon tunggu...", "info");
    isPrinting = true;
    showToast("Mengirim data ke printer...", "info");

    try {
        const tx = currentViewedTx;
        
        // Perintah ESC/POS
        const ESC = '\u001B'; const GS = '\u001D';
        const center = ESC + 'a' + '\u0001'; const left = ESC + 'a' + '\u0000';
        const boldOn = ESC + 'E' + '\u0001'; const boldOff = ESC + 'E' + '\u0000';
        const bigFont = GS + '!' + '\u0011'; const normalFont = GS + '!' + '\u0000';
        const init = ESC + '@';

        // HEADER
        let receiptText = 
            init + 
            center + boldOn + bigFont + "Nama Toko Anda" + normalFont + boldOff + "\n" +
            "0811-2222-3333 (WA)\n" +
            "Alamat Toko Nanti Disini\n" +
            "--------------------------------\n" +
            left + 
            `Plg : ${tx.nama}\n` +
            `WA  : ${tx.wa}\n` +
            "--------------------------------\n";

        // ITEMS
        tx.items.forEach((item) => {
            // Baris 1: Nama Barang (Ukuran)
            receiptText += `${boldOn}${item.nama} (${item.ukuran})${boldOff}\n`;
            
            // Baris 2: Qty x Harga = Subtotal (Manual padding spasi)
            let detailStr = `  ${item.jml} x Rp ${item.harga.toLocaleString('id-ID')}`;
            let subtotalStr = `Rp ${item.subtotal.toLocaleString('id-ID')}`;
            
            // Menghitung spasi agar subtotal rata kanan (asumsi 32 karakter per baris utk 58mm)
            let spaceCount = 32 - (detailStr.length + subtotalStr.length);
            if (spaceCount < 1) spaceCount = 1; 
            
            receiptText += detailStr + " ".repeat(spaceCount) + subtotalStr + "\n";
        });

        // FOOTER & TOTAL
        receiptText += 
            "--------------------------------\n" +
            `Total Item : ${tx.totalItem}\n` +
            boldOn + 
            `TOTAL BAYAR: Rp ${tx.totalHarga.toLocaleString('id-ID')}\n` +
            boldOff +
            "--------------------------------\n" +
            center + "Barang yang sudah dibeli\n" +
            "tidak dapat ditukar/dikembalikan\n" +
            "Terima Kasih, Semoga Berkah!\n\n\n\n"; // \n ekstra untuk feed kertas

        // Encode ke Bytes
        let encodedData = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(receiptText) : strToBytes(receiptText);
        
        // Kirim bergiliran (Chunking) untuk mencegah buffer penuh di printer kecil
        const maxChunk = 50; 
        for (let i = 0; i < encodedData.length; i += maxChunk) {
            const chunk = encodedData.slice(i, i + maxChunk);
            await printerCharacteristic.writeValue(chunk);
            await new Promise(resolve => setTimeout(resolve, 50)); // Jeda 50ms per chunk
        }

        showToast("Selesai mencetak!");

    } catch (error) { 
        console.error(error);
        showToast("Gagal mencetak: Cek koneksi printer.", "error"); 
        onDisconnected();
    } finally {
        isPrinting = false;
    }
}

// 3. Ganti Fungsi cetakStruk() Lama menjadi ini
function cetakStrukA4() {
    window.print();
}
