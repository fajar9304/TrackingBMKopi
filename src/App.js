import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, onSnapshot, query, Timestamp, writeBatch, deleteDoc, updateDoc, serverTimestamp, arrayUnion, setLogLevel, getDoc, setDoc } from 'firebase/firestore';

// --- Konfigurasi Firebase (Disediakan oleh lingkungan) ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'tracking-bm-kopi';


// --- Data Awal (jika database kosong) ---
const INITIAL_PRODUCTS = [
    { name: "Kopi Gula Aren", price: 8000 },
    { name: "Coklat", price: 8000 },
    { name: "Americano", price: 8000 },
    { name: "Greentea", price: 8000 }
];
const INITIAL_PARTNERS = [
    "JIH", "IPIN", "BAROKAH", "MARGONO", "TELKOM", "RSDK", "BIOLOGI", "PERTANIAN",
    "ENJOY", "BIOLOGI 2", "PERTANIAN 2", "SINAR KASIH", "PERUM MAS AFIF", "DIMSUM",
    "RS BUNDA", "KLINIK ADRIO", "RS WIRADADI", "MANDIRI PUSAT", "KEMENAG",
    "BTN PURWOKERTO", "RSI", "BANK JATENG", "FIKES UMP", "RS DKT",
    "FACHRUDIN TOWER", "PSIKOLOGI UMP", "LPPH HUKUM UNSOED"
];
const INITIAL_EMPLOYEES = ["Gigih", "Fajar", "Pandu", "Ade"];

// --- Fungsi Utilitas untuk Ekstrak CSV ---
const exportToCSV = (data, filename) => {
    if (data.length === 0) {
        console.log("Tidak ada data untuk diekstrak.");
        return;
    }
    const headers = ['Tanggal', 'Produk', 'Mitra', 'Jumlah', 'Petugas'];
    const rows = data.map(item => {
        const dateString = item.tanggal && item.tanggal.toDate ? `"${item.tanggal.toDate().toLocaleString('id-ID')}"` : '""';
        return [
            dateString,
            `"${item.namaProduk}"`,
            `"${item.namaMitra}"`,
            item.jumlah,
            `"${item.namaPetugas || ''}"`
        ].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const exportCanvasingToCSV = (data, filename) => {
    if (data.length === 0) {
        console.log("Tidak ada data canvasing untuk diekstrak.");
        return;
    }
    const headers = ['Tanggal Absen', 'Karyawan', 'Waktu Kunjungan', 'Lokasi Kunjungan', 'Catatan'];
    const rows = [];

    data.forEach(attendance => {
        const attendanceDate = attendance.clockInTime?.toDate().toLocaleDateString('id-ID') || 'N/A';
        const employeeName = attendance.employeeName;
        
        const visits = attendance.journey?.filter(j => j.type === 'visit') || [];
        
        if (visits.length === 0) {
            rows.push([`"${attendanceDate}"`, `"${employeeName}"`, '"-"', '"-"', '"Tidak ada kunjungan"']);
        } else {
            visits.forEach(visit => {
                const visitTimestamp = visit.timestamp?.toDate ? visit.timestamp.toDate().toLocaleString('id-ID') : 'N/A';
                rows.push([
                    `"${attendanceDate}"`,
                    `"${employeeName}"`,
                    `"${visitTimestamp}"`,
                    `"${visit.location || ''}"`,
                    `"${(visit.notes || '').replace(/"/g, '""')}"`
                ]);
            });
        }
    });

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};


// --- Komponen-komponen Aplikasi ---

const MainMenu = ({ setView, consignmentList, returnList, allProducts }) => (
    <div className="space-y-8">
        <SummaryCard 
            consignmentList={consignmentList} 
            returnList={returnList} 
            allProducts={allProducts} 
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <MenuCard 
                title="Input Data Dropping" 
                description="Mencatat penitipan produk baru ke mitra."
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M5.5 13a3.5 3.5 0 01-.369-6.98 4 4 0 117.739 0A3.5 3.5 0 0114.5 13H5.5z" /><path d="M9 13.5a1 1 0 011 1v4.5a1 1 0 11-2 0V14.5a1 1 0 011-1z" /></svg>}
                onClick={() => setView('dropping')}
            />
             <MenuCard 
                title="Input Data Return" 
                description="Mencatat produk yang dikembalikan dari mitra."
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M15.707 15.707a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 010 1.414zm-6 0a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 1.414L5.414 10l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" /></svg>}
                onClick={() => setView('return')}
            />
            <MenuCard 
                title="Canvasing Mitra" 
                description="Absensi harian dan laporan kunjungan untuk tim."
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 11a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1v-1z" /></svg>}
                onClick={() => setView('canvasing')}
            />
            <MenuCard 
                title="Ekstrak Data" 
                description="Lihat riwayat, filter, dan unduh laporan CSV."
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3zm3.146 2.146a.5.5 0 01.708 0L10 8.293l3.146-3.147a.5.5 0 01.708.708L10.707 9l3.147 3.146a.5.5 0 01-.708.708L10 9.707l-3.146 3.147a.5.5 0 01-.708-.708L9.293 9 6.146 5.854a.5.5 0 010-.708z" clipRule="evenodd" /></svg>}
                onClick={() => setView('ekstrak')}
            />
            <MenuCard 
                title="Akses Dashboard Admin" 
                description="Kelola data master dan hapus transaksi."
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" /></svg>}
                onClick={() => setView('dashboard')}
            />
        </div>
    </div>
);

const MenuCard = ({ title, description, icon, onClick }) => (
    <div onClick={onClick} className="bg-white p-6 rounded-xl shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col items-start text-left">
        <div className="bg-blue-100 text-blue-600 p-3 rounded-lg mb-4">
            {icon}
        </div>
        <h3 className="text-lg font-bold text-gray-800 mb-1">{title}</h3>
        <p className="text-sm text-gray-500 flex-grow">{description}</p>
    </div>
);

const Header = () => (
    <header className="bg-white shadow-md rounded-lg p-4 flex items-center">
        <svg className="h-10 w-10 text-blue-600" viewBox="0 0 64 64" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M32,1C14.88,1,1,14.88,1,32s13.88,31,31,31s31-13.88,31-31S49.12,1,32,1z M32,57.7C17.84,57.7,6.3,46.16,6.3,32 C6.3,17.84,17.84,6.3,32,6.3C46.16,6.3,57.7,17.84,57.7,32C57.7,46.16,46.16,57.7,32,57.7z"/>
            <path d="M32.01,12.21c-8.23,0-16.46,10.59-16.46,19.79s8.23,19.79,16.46,19.79s16.46-10.59,16.46-19.79S40.24,12.21,32.01,12.21z"/>
        </svg>
        <div className="ml-4">
            <h1 className="text-2xl font-bold text-gray-800">Aplikasi Induk BM Kopi</h1>
            <p className="text-sm text-gray-500">Sistem Manajemen Terpadu untuk Operasional dan Marketing.</p>
        </div>
    </header>
);

const ConsignmentForm = ({ db, appId, disabled, products, partners, employees }) => {
    const [partner, setPartner] = useState("");
    const [officerName, setOfficerName] = useState("");
    const [items, setItems] = useState([{ product: "", quantity: "" }]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formMessage, setFormMessage] = useState({ type: '', text: '' });

    const handleItemChange = (index, field, value) => {
        const newItems = [...items];
        newItems[index][field] = value;
        setItems(newItems);
    };

    const addItemRow = () => {
        setItems([...items, { product: "", quantity: "" }]);
    };

    const removeItemRow = (index) => {
        const newItems = items.filter((_, i) => i !== index);
        setItems(newItems);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormMessage({ type: '', text: '' });

        if (!officerName) {
            setFormMessage({ type: 'error', text: 'Harap pilih nama petugas.' });
            return;
        }
        if (!partner) {
            setFormMessage({ type: 'error', text: 'Harap pilih mitra terlebih dahulu.' });
            return;
        }

        const validItems = items.filter(item => item.product && item.quantity > 0);
        if (validItems.length === 0) {
            setFormMessage({ type: 'error', text: 'Harap isi setidaknya satu produk dengan jumlah yang benar.' });
            return;
        }

        setIsSubmitting(true);
        try {
            const batch = writeBatch(db);
            const penitipanCollection = collection(db, `artifacts/${appId}/public/data/penitipan`);
            
            validItems.forEach(item => {
                const docRef = doc(penitipanCollection);
                batch.set(docRef, {
                    namaProduk: item.product,
                    namaMitra: partner,
                    jumlah: Number(item.quantity),
                    tanggal: Timestamp.now(),
                    namaPetugas: officerName,
                });
            });

            await batch.commit();
            
            setPartner("");
            setOfficerName("");
            setItems([{ product: "", quantity: "" }]);
            setFormMessage({ type: 'success', text: `${validItems.length} data produk berhasil disimpan!` });
            setTimeout(() => setFormMessage({ type: '', text: '' }), 3000);

        } catch (error) {
            console.error("Error adding documents in batch: ", error);
            setFormMessage({ type: 'error', text: 'Gagal menyimpan data.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md h-full">
            <h2 className="text-xl font-bold text-gray-700 mb-4">Input Data Dropping</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <SelectInput id="officer" label="Nama Petugas (Wajib)" value={officerName} onChange={(e) => setOfficerName(e.target.value)} options={employees.map(e => e.name)} placeholder="Pilih Nama Petugas..." />
                <SearchableSelect label="Mitra" options={partners.map(p => p.name)} value={partner} onChange={setPartner} placeholder="Cari & Pilih Mitra..." />
                <hr/>
                <div className="space-y-3">
                    {items.map((item, index) => (
                        <div key={index} className="flex items-end space-x-2 p-2 bg-slate-50 rounded-md">
                            <div className="flex-grow">
                                <SelectInput id={`product-${index}`} label={`Produk ${index + 1}`} value={item.product} onChange={(e) => handleItemChange(index, 'product', e.target.value)} options={products.map(p => p.name)} placeholder="Pilih Produk..." />
                            </div>
                            <div className="w-24">
                                <label htmlFor={`quantity-${index}`} className="block text-sm font-medium text-gray-600">Jumlah</label>
                                <input type="number" id={`quantity-${index}`} value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', e.target.value)} min="1" className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                            <button type="button" onClick={() => removeItemRow(index)} disabled={items.length <= 1} className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600 disabled:bg-red-300">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg>
                            </button>
                        </div>
                    ))}
                </div>
                <button type="button" onClick={addItemRow} className="w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400">
                    + Tambah Produk Lain
                </button>
                <button type="submit" disabled={isSubmitting || disabled} className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400">
                    {isSubmitting ? 'Menyimpan...' : 'Simpan Semua Data'}
                </button>
            </form>
            {formMessage.text && <FormMessage type={formMessage.type} text={formMessage.text} />}
        </div>
    );
};

const ReturnForm = ({ db, appId, disabled, products, partners, employees }) => {
    const [partner, setPartner] = useState("");
    const [officerName, setOfficerName] = useState("");
    const [items, setItems] = useState([{ product: "", quantity: "" }]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formMessage, setFormMessage] = useState({ type: '', text: '' });

    const handleItemChange = (index, field, value) => {
        const newItems = [...items];
        newItems[index][field] = value;
        setItems(newItems);
    };

    const addItemRow = () => {
        setItems([...items, { product: "", quantity: "" }]);
    };

    const removeItemRow = (index) => {
        const newItems = items.filter((_, i) => i !== index);
        setItems(newItems);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormMessage({ type: '', text: '' });

        if (!officerName) {
            setFormMessage({ type: 'error', text: 'Harap pilih nama petugas.' });
            return;
        }
        if (!partner) {
            setFormMessage({ type: 'error', text: 'Harap pilih mitra terlebih dahulu.' });
            return;
        }

        const validItems = items.filter(item => item.product && item.quantity > 0);
        if (validItems.length === 0) {
            setFormMessage({ type: 'error', text: 'Harap isi setidaknya satu produk dengan jumlah yang benar.' });
            return;
        }

        setIsSubmitting(true);
        try {
            const batch = writeBatch(db);
            const returnCollection = collection(db, `artifacts/${appId}/public/data/pengembalian`);
            
            validItems.forEach(item => {
                const docRef = doc(returnCollection);
                batch.set(docRef, {
                    namaProduk: item.product,
                    namaMitra: partner,
                    jumlah: Number(item.quantity),
                    tanggal: Timestamp.now(),
                    namaPetugas: officerName,
                });
            });

            await batch.commit();
            
            setPartner("");
            setOfficerName("");
            setItems([{ product: "", quantity: "" }]);
            setFormMessage({ type: 'success', text: `${validItems.length} data return berhasil disimpan!` });
            setTimeout(() => setFormMessage({ type: '', text: '' }), 3000);

        } catch (error) {
            console.error("Error adding return documents in batch: ", error);
            setFormMessage({ type: 'error', text: 'Gagal menyimpan data return.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md h-full">
            <h2 className="text-xl font-bold text-gray-700 mb-4">Input Data Return</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <SelectInput id="officer" label="Nama Petugas (Wajib)" value={officerName} onChange={(e) => setOfficerName(e.target.value)} options={employees.map(e => e.name)} placeholder="Pilih Nama Petugas..." />
                <SearchableSelect label="Mitra Pengembali" options={partners.map(p => p.name)} value={partner} onChange={setPartner} placeholder="Cari & Pilih Mitra..." />
                <hr/>
                <div className="space-y-3">
                    {items.map((item, index) => (
                        <div key={index} className="flex items-end space-x-2 p-2 bg-slate-50 rounded-md">
                            <div className="flex-grow">
                                <SelectInput id={`product-${index}`} label={`Produk ${index + 1}`} value={item.product} onChange={(e) => handleItemChange(index, 'product', e.target.value)} options={products.map(p => p.name)} placeholder="Pilih Produk..." />
                            </div>
                            <div className="w-24">
                                <label htmlFor={`quantity-${index}`} className="block text-sm font-medium text-gray-600">Jumlah</label>
                                <input type="number" id={`quantity-${index}`} value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', e.target.value)} min="1" className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                            <button type="button" onClick={() => removeItemRow(index)} disabled={items.length <= 1} className="bg-red-500 text-white p-2 rounded-md hover:bg-red-600 disabled:bg-red-300">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg>
                            </button>
                        </div>
                    ))}
                </div>
                <button type="button" onClick={addItemRow} className="w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400">
                    + Tambah Produk Lain
                </button>
                <button type="submit" disabled={isSubmitting || disabled} className="w-full bg-orange-600 text-white py-2 px-4 rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:bg-gray-400">
                    {isSubmitting ? 'Menyimpan...' : 'Simpan Data Return'}
                </button>
            </form>
            {formMessage.text && <FormMessage type={formMessage.type} text={formMessage.text} />}
        </div>
    );
};


const FilterAndExportPanel = ({ filters, setFilters, allProducts, allPartners, allEmployees, dataToExport, onExport, dataType, setDataType }) => {
    const handleFilterChange = (name, value) => {
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const resetFilters = () => {
        setFilters({ startDate: '', endDate: '', product: '', partner: '', officer: '' });
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold text-gray-700 mb-4">Filter dan Ekstrak Data</h2>
            
            <div className="mb-4 flex space-x-2 border-b">
                <button 
                    onClick={() => setDataType('dropping')} 
                    className={`py-2 px-4 font-medium text-sm ${dataType === 'dropping' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
                >
                    Data Dropping
                </button>
                <button 
                    onClick={() => setDataType('return')} 
                    className={`py-2 px-4 font-medium text-sm ${dataType === 'return' ? 'border-b-2 border-orange-600 text-orange-600' : 'text-gray-500'}`}
                >
                    Data Return
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <DateInput label="Dari Tanggal" name="startDate" value={filters.startDate} onChange={(e) => handleFilterChange(e.target.name, e.target.value)} />
                <DateInput label="Sampai Tanggal" name="endDate" value={filters.endDate} onChange={(e) => handleFilterChange(e.target.name, e.target.value)} />
                <SelectInput id="filter-product" label="Produk" value={filters.product} onChange={(e) => handleFilterChange('product', e.target.value)} options={allProducts.map(p => p.name)} placeholder="Semua Produk" />
                <SearchableSelect label="Mitra" options={allPartners.map(p => p.name)} value={filters.partner} onChange={(value) => handleFilterChange('partner', value)} placeholder="Cari & Pilih Mitra..." />
                <SelectInput id="filter-officer" label="Petugas" value={filters.officer} onChange={(e) => handleFilterChange('officer', e.target.value)} options={allEmployees.map(e => e.name)} placeholder="Semua Petugas" />
            </div>
            <div className="mt-6 flex flex-col sm:flex-row gap-2">
                <button onClick={onExport} className="w-full sm:w-auto flex-grow bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500">
                    Ekstrak ke CSV ({dataToExport.length} data)
                </button>
                 <button onClick={resetFilters} className="w-full sm:w-auto bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400">
                    Reset Filter
                </button>
            </div>
        </div>
    );
};

const AdminDashboardView = ({ db, appId, disabled, onUnlock, isManagerMode, allProducts, adminConfig, auth, attendanceData }) => {
    const [isLocked, setIsLocked] = useState(!isManagerMode);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState({type: '', text: ''});
    
    const handleUnlock = () => {
        if (password === adminConfig.password) {
            setIsLocked(false);
            setError('');
            setPassword('');
            onUnlock(true);
        } else {
            setError('Password salah, coba lagi.');
        }
    };
    
    const handleLock = () => {
        setIsLocked(true);
        onUnlock(false);
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleUnlock();
        }
    };
    
    const handleResetPassword = async () => {
        setMessage({type: '', text: ''});
        const email = "kontekfajar@gmail.com";
        try {
            await sendPasswordResetEmail(auth, email);
            setMessage({type: 'success', text: `Link reset password telah dikirim ke ${email}.`});
        } catch (error) {
            console.error("Error sending password reset email:", error);
            setMessage({type: 'error', text: `Gagal mengirim email. Pastikan Anda login dengan akun email, bukan anonim. Error: ${error.message}`});
        }
    };

    if (isLocked) {
        return (
            <div className="bg-white p-6 rounded-lg shadow-md max-w-md mx-auto">
                <h2 className="text-xl font-bold text-gray-700 mb-4">Dashboard Admin (Terkunci)</h2>
                <p className="text-gray-600 mb-4">Masukkan password untuk mengakses semua fitur admin.</p>
                <div className="space-y-4">
                    <div className="flex items-center space-x-2">
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Masukkan password..."
                            className="flex-grow p-2 border border-gray-300 rounded-md shadow-sm"
                        />
                        <button onClick={handleUnlock} className="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700">
                            Buka
                        </button>
                    </div>
                    <div className="text-center">
                        <button onClick={handleResetPassword} className="text-sm text-blue-600 hover:underline">
                            Lupa Password?
                        </button>
                    </div>
                </div>
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                {message.text && <FormMessage type={message.type} text={message.text} />}
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="bg-white p-6 rounded-lg shadow-md">
                 <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-700">Panel Pengelolaan</h2>
                    <button onClick={handleLock} className="text-sm bg-gray-200 text-gray-700 py-1 px-3 rounded-md hover:bg-gray-300">
                        Kunci Dashboard
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <AddItemForm db={db} appId={appId} disabled={disabled} collectionName="products" itemName="Produk" placeholder="Nama produk baru..." />
                    <AddItemForm db={db} appId={appId} disabled={disabled} collectionName="partners" itemName="Mitra" placeholder="Nama mitra baru..." />
                    <AddItemForm db={db} appId={appId} disabled={disabled} collectionName="employees" itemName="Karyawan" placeholder="Nama karyawan baru..." />
                </div>
            </div>
            
            <ManageProducts db={db} appId={appId} allProducts={allProducts} />
            <ManagePassword db={db} appId={appId} adminConfig={adminConfig} />
            <CanvasingAdminDashboard db={db} appId={appId} attendanceData={attendanceData} />
        </div>
    );
};

const ManageProducts = ({ db, appId, allProducts }) => {
    const [productPrices, setProductPrices] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState({type: '', text: ''});

    useEffect(() => {
        const prices = {};
        allProducts.forEach(p => {
            prices[p.id] = p.price || 0;
        });
        setProductPrices(prices);
    }, [allProducts]);

    const handlePriceChange = (productId, newPrice) => {
        setProductPrices(prev => ({...prev, [productId]: newPrice}));
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setMessage({type: '', text: ''});
        try {
            const batch = writeBatch(db);
            Object.entries(productPrices).forEach(([productId, price]) => {
                if (productId) { // Pastikan ID produk ada
                    const docRef = doc(db, `artifacts/${appId}/public/data/products`, productId);
                    batch.update(docRef, { price: Number(price) });
                }
            });
            await batch.commit();
            setMessage({type: 'success', text: 'Harga produk berhasil diperbarui!'});
        } catch (error) {
            console.error("Error updating prices: ", error);
            setMessage({type: 'error', text: 'Gagal memperbarui harga.'});
        } finally {
            setIsSubmitting(false);
            setTimeout(() => setMessage({type: '', text: ''}), 3000);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold text-gray-700 mb-4">Pengelolaan Harga Produk</h2>
            <div className="space-y-3">
                {allProducts.filter(p => p.id).map(product => ( // Hanya tampilkan produk dari DB
                    <div key={product.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-md">
                        <span className="font-medium text-gray-800">{product.name}</span>
                        <div className="flex items-center space-x-2">
                            <span className="text-gray-500">Rp</span>
                            <input 
                                type="number" 
                                value={productPrices[product.id] || ''}
                                onChange={(e) => handlePriceChange(product.id, e.target.value)}
                                className="w-32 p-1 border border-gray-300 rounded-md shadow-sm"
                            />
                        </div>
                    </div>
                ))}
            </div>
            <button onClick={handleSubmit} disabled={isSubmitting} className="mt-4 w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                {isSubmitting ? 'Menyimpan...' : 'Simpan Semua Perubahan Harga'}
            </button>
            {message.text && <FormMessage type={message.type} text={message.text} />}
        </div>
    );
};

const ManagePassword = ({ db, appId, adminConfig }) => {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState({type: '', text: ''});

    const handleChangePassword = async () => {
        setMessage({type: '', text: ''});
        if (oldPassword !== adminConfig.password) {
            setMessage({type: 'error', text: 'Password lama salah.'});
            return;
        }
        if (!newPassword || newPassword.length < 6) {
            setMessage({type: 'error', text: 'Password baru minimal 6 karakter.'});
            return;
        }
        setIsSubmitting(true);
        try {
            const configRef = doc(db, `artifacts/${appId}/public/data/config`, 'admin');
            await updateDoc(configRef, { password: newPassword });
            setOldPassword('');
            setNewPassword('');
            setMessage({type: 'success', text: 'Password berhasil diubah!'});
        } catch (error) {
            console.error("Error changing password:", error);
            setMessage({type: 'error', text: 'Gagal mengubah password.'});
        } finally {
            setIsSubmitting(false);
            setTimeout(() => setMessage({type: '', text: ''}), 3000);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold text-gray-700 mb-4">Pengelolaan Password Admin</h2>
            <div className="space-y-4">
                <input 
                    type="password" 
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="Password Lama"
                    className="w-full p-2 border border-gray-300 rounded-md"
                />
                <input 
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Password Baru"
                    className="w-full p-2 border border-gray-300 rounded-md"
                />
                <button onClick={handleChangePassword} disabled={isSubmitting} className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400">
                    {isSubmitting ? 'Mengubah...' : 'Ubah Password'}
                </button>
            </div>
             {message.text && <FormMessage type={message.type} text={message.text} />}
        </div>
    );
};


const AddItemForm = ({ db, appId, disabled, collectionName, itemName, placeholder }) => {
    const [name, setName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) {
            setMessage({ type: 'error', text: 'Nama tidak boleh kosong.' });
            return;
        }
        setIsSubmitting(true);
        try {
            const data = { name: name.trim() };
            if (collectionName === 'products') {
                data.price = 8000; // Harga default untuk produk baru
            }
            await addDoc(collection(db, `artifacts/${appId}/public/data/${collectionName}`), data);
            setName('');
            setMessage({ type: 'success', text: `${itemName} berhasil ditambahkan!` });
            setTimeout(() => setMessage({ type: '', text: '' }), 3000);
        } catch (error) {
            console.error(`Error adding ${itemName}:`, error);
            setMessage({ type: 'error', text: `Gagal menambahkan ${itemName}.` });
        } finally {
            setIsSubmitting(false);
        }
    };
    return (
        <div>
            <h3 className="text-lg font-semibold text-gray-600 mb-2">Tambah {itemName} Baru</h3>
            <form onSubmit={handleSubmit} className="flex items-center space-x-2">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} className="flex-grow p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" disabled={disabled} />
                <button type="submit" disabled={isSubmitting || disabled} className="bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400">
                    {isSubmitting ? '...' : 'Tambah'}
                </button>
            </form>
            {message.text && <FormMessage type={message.type} text={message.text} />}
        </div>
    );
};

const SummaryCard = ({ consignmentList, returnList, allProducts }) => {
    const formatCurrency = (value) => {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value);
    };

    const { netStockSummary, totalValue } = useMemo(() => {
        const productMap = allProducts.reduce((map, prod) => {
            map[prod.name] = { stock: 0, price: prod.price || 0 };
            return map;
        }, {});
        
        consignmentList.forEach(item => {
            if (productMap[item.namaProduk]) {
                productMap[item.namaProduk].stock += item.jumlah;
            }
        });

        returnList.forEach(item => {
            if (productMap[item.namaProduk]) {
                productMap[item.namaProduk].stock -= item.jumlah;
            }
        });

        const total = Object.values(productMap).reduce((acc, {stock, price}) => acc + (stock * price), 0);
        
        return { netStockSummary: productMap, totalValue: total };
    }, [consignmentList, returnList, allProducts]);

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold text-gray-700 mb-4">Total Stok Bersih Dititipkan</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {Object.entries(netStockSummary).map(([name, {stock, price}]) => (
                    <div key={name} className="bg-slate-50 p-4 rounded-lg text-center flex flex-col justify-between">
                        <div>
                           <p className="text-sm text-gray-600 truncate" title={name}>{name}</p>
                           <p className="text-2xl font-bold text-blue-600">{stock}</p>
                        </div>
                        <div className="mt-2">
                            <p className="text-xs text-green-700 font-semibold bg-green-100 rounded-full px-2 py-1">{formatCurrency(stock * price)}</p>
                        </div>
                    </div>
                ))}
            </div>
            <hr className="my-6" />
            <div className="text-center">
                <p className="text-md text-gray-600">Akumulasi Nilai Barang</p>
                <p className="text-3xl font-bold text-green-800">{formatCurrency(totalValue)}</p>
            </div>
        </div>
    );
};

const HistoryTable = ({ data, loading, isManagerMode, onDeleteRequest, title }) => {
    const formatDate = (timestamp) => {
        if (!timestamp || !timestamp.toDate) return 'N/A';
        return timestamp.toDate().toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold text-gray-700 mb-4">{title}</h2>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tanggal</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produk</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mitra</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Jumlah</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Petugas</th>
                            {isManagerMode && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Aksi</th>}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan={isManagerMode ? 6 : 5} className="text-center py-4">Memuat data...</td></tr>
                        ) : data.length === 0 ? (
                             <tr><td colSpan={isManagerMode ? 6 : 5} className="text-center py-4 text-gray-500">Tidak ada data yang cocok dengan filter.</td></tr>
                        ) : (
                            data.map(item => (
                                <tr key={item.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(item.tanggal)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.namaProduk}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.namaMitra}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{item.jumlah}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.namaPetugas}</td>
                                    {isManagerMode && (
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            <button onClick={() => onDeleteRequest({id: item.id, product: item.namaProduk, partner: item.namaMitra, type: item.type})} className="text-red-600 hover:text-red-900">
                                                Hapus
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ isOpen, onClose, onConfirm, message }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center">
            <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Konfirmasi Tindakan</h3>
                <p className="text-sm text-gray-600 mb-6">{message}</p>
                <div className="flex justify-end space-x-4">
                    <button onClick={onClose} className="bg-gray-200 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-300">
                        Batal
                    </button>
                    <button onClick={onConfirm} className="bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700">
                        Ya, Hapus
                    </button>
                </div>
            </div>
        </div>
    );
};

const SearchableSelect = ({ label, options, value, onChange, placeholder }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef(null);
    const filteredOptions = useMemo(() =>
        options.filter(option =>
            option.toLowerCase().includes(searchTerm.toLowerCase())
        ), [options, searchTerm]);
    const handleSelect = (option) => {
        onChange(option);
        setIsOpen(false);
        setSearchTerm('');
    };
    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);
    return (
        <div className="relative" ref={wrapperRef}>
            <label className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
            <div className="relative">
                <button type="button" onClick={() => setIsOpen(!isOpen)} className="w-full p-2 text-left bg-white border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
                    <span className="block truncate">{value || placeholder}</span>
                     <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                        <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M10 3a.75.75 0 01.53.22l3.5 3.5a.75.75 0 01-1.06 1.06L10 4.81 7.03 7.78a.75.75 0 01-1.06-1.06l3.5-3.5A.75.75 0 0110 3zm-3.5 9.5a.75.75 0 011.06 0L10 15.19l2.97-2.97a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 010-1.06z" clipRule="evenodd" /></svg>
                    </span>
                </button>
            </div>
            {isOpen && (
                <div className="absolute z-10 mt-1 w-full bg-white shadow-lg rounded-md border border-gray-300">
                    <div className="p-2">
                        <input
                            type="text"
                            placeholder="Cari..."
                            className="w-full p-2 border border-gray-300 rounded-md"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <ul className="max-h-60 overflow-auto">
                        {filteredOptions.length > 0 ? filteredOptions.map(option => (
                            <li key={option} onClick={() => handleSelect(option)} className="p-2 hover:bg-blue-100 cursor-pointer">
                                {option}
                            </li>
                        )) : <li className="p-2 text-gray-500">Tidak ditemukan.</li>}
                    </ul>
                </div>
            )}
        </div>
    );
};

const SelectInput = ({ id, label, value, onChange, options, placeholder }) => (
    <div>
        <label htmlFor={id} className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
        <select id={id} value={value} onChange={onChange} className="block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
            <option value="">{placeholder}</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
    </div>
);

const DateInput = ({ label, name, value, onChange }) => (
    <div>
        <label htmlFor={name} className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
        <input type="date" id={name} name={name} value={value} onChange={onChange} className="block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
    </div>
);

const FormMessage = ({ type, text }) => (
    <div className={`mt-4 text-sm p-3 rounded-md ${type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
        {text}
    </div>
);

const ErrorMessage = ({ message }) => (
    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mt-4" role="alert">
        <strong className="font-bold">Error! </strong>
        <span className="block sm:inline ml-2">{message}</span>
    </div>
);

const CanvasingApp = ({ db, appId, disabled }) => {
    const [employeeName, setEmployeeName] = useState('');
    const [isClockedIn, setIsClockedIn] = useState(false);
    const [currentAttendanceId, setCurrentAttendanceId] = useState(null);
    const [clockInTime, setClockInTime] = useState(null);
    
    const [visitLocation, setVisitLocation] = useState('');
    const [visitNotes, setVisitNotes] = useState('');
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreview, setPhotoPreview] = useState('');
    const [isSendingReport, setIsSendingReport] = useState(false);
    
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });

    const showNotification = (message, type = 'success') => {
        setNotification({ show: true, message, type });
        setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 3000);
    };

    const handleClockIn = async () => {
        if (!employeeName.trim()) {
            showNotification("Nama wajib diisi.", "error");
            return;
        }
        try {
            const clockInTimestamp = new Date();
            const docRef = await addDoc(collection(db, `artifacts/${appId}/public/data/absensi`), {
                employeeName: employeeName.trim(),
                clockInTime: serverTimestamp(),
                clockOutTime: null,
                status: 'active',
                journey: [{ type: 'clock-in', timestamp: clockInTimestamp }]
            });
            setCurrentAttendanceId(docRef.id);
            setIsClockedIn(true);
            setClockInTime(clockInTimestamp);
            showNotification("Berhasil absen masuk!");
        } catch (e) {
            showNotification(`Gagal absen: ${e.message}`, "error");
        }
    };

    const handleClockOut = async () => {
        if (!currentAttendanceId) return;
        try {
            const attendanceDocRef = doc(db, `artifacts/${appId}/public/data/absensi`, currentAttendanceId);
            await updateDoc(attendanceDocRef, {
                clockOutTime: serverTimestamp(),
                status: 'completed',
                journey: arrayUnion({ type: 'clock-out', timestamp: new Date() })
            });
            showNotification("Berhasil absen pulang.");
            setIsClockedIn(false);
            setCurrentAttendanceId(null);
            setEmployeeName('');
            setClockInTime(null);
        } catch (e) {
            showNotification(`Gagal absen pulang: ${e.message}`, "error");
        }
    };

    const handlePhotoChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setPhotoFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setPhotoPreview(reader.result);
            };
            reader.readAsDataURL(file);
        }
    };
    
    const resizeAndEncodeImage = (file) => {
        const IMAGE_MAX_WIDTH = 800;
        const IMAGE_QUALITY = 0.7;
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const scale = IMAGE_MAX_WIDTH / img.width;
                    canvas.width = IMAGE_MAX_WIDTH;
                    canvas.height = img.height * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
                };
                img.onerror = reject;
                img.src = event.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const handleSendReport = async () => {
        if (!visitLocation.trim()) {
            showNotification("Lokasi prospek wajib diisi.", "error");
            return;
        }
        if (!photoFile) {
            showNotification("Silakan ambil foto bukti terlebih dahulu.", "error");
            return;
        }
        setIsSendingReport(true);
        try {
            const photoBase64 = await resizeAndEncodeImage(photoFile);
            const report = {
                type: 'visit',
                location: visitLocation.trim(),
                notes: visitNotes.trim(),
                photo: photoBase64,
                timestamp: new Date()
            };
            const attendanceDocRef = doc(db, `artifacts/${appId}/public/data/absensi`, currentAttendanceId);
            await updateDoc(attendanceDocRef, {
                journey: arrayUnion(report)
            });
            showNotification("Laporan prospek berhasil dikirim!");
            setVisitLocation('');
            setVisitNotes('');
            setPhotoFile(null);
            setPhotoPreview('');
        } catch (e) {
            showNotification(`Gagal mengirim laporan: ${e.message}`, "error");
        } finally {
            setIsSendingReport(false);
        }
    };
    
    return (
        <div className="space-y-8">
             <header className="text-center">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-700">Aplikasi Canvasing Mitra</h1>
                <p className="text-gray-500 mt-2">Sistem Laporan Canvasing untuk Prospek Mitra Baru.</p>
            </header>

            <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
                <div className="grid md:grid-cols-2 gap-8 items-start">
                    <div>
                        <h2 className="text-xl font-semibold mb-4">1. Absensi Harian</h2>
                        <div className="space-y-4">
                            <input type="text" value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} placeholder="Masukkan Nama Anda" className="w-full px-4 py-3 border border-gray-300 rounded-lg" disabled={isClockedIn} />
                            <button onClick={handleClockIn} className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700" disabled={isClockedIn}>
                                Absen Masuk
                            </button>
                            <button onClick={handleClockOut} className="w-full bg-red-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-red-700" disabled={!isClockedIn}>
                                Absen Pulang
                            </button>
                        </div>
                    </div>
                    <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
                        <h3 className="text-lg font-semibold mb-3">Status Saat Ini</h3>
                        <div className="text-gray-600 space-y-2">
                            <p><strong>Karyawan:</strong> <span className="font-mono">{isClockedIn ? employeeName : '-'}</span></p>
                            <p><strong>Status:</strong> <span className={`font-mono px-2 py-1 rounded ${isClockedIn ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-800'}`}>{isClockedIn ? 'Sudah Absen' : 'Belum Absen'}</span></p>
                            <p><strong>Waktu Masuk:</strong> <span className="font-mono">{clockInTime ? clockInTime.toLocaleTimeString('id-ID') : '-'}</span></p>
                        </div>
                    </div>
                </div>
            </div>

            <div className={`bg-white rounded-xl shadow-lg p-6 md:p-8 ${!isClockedIn ? 'opacity-50 pointer-events-none' : ''}`}>
                <h2 className="text-xl font-semibold mb-4">2. Laporan Kunjungan Prospek Mitra</h2>
                <div className="space-y-4">
                    <input type="text" value={visitLocation} onChange={(e) => setVisitLocation(e.target.value)} placeholder="Ketik Lokasi Prospek Mitra" className="w-full px-4 py-3 border border-gray-300 rounded-lg" />
                    <textarea value={visitNotes} onChange={(e) => setVisitNotes(e.target.value)} placeholder="Catatan kunjungan (opsional)..." rows="2" className="w-full px-4 py-3 border border-gray-300 rounded-lg"></textarea>
                    <div>
                        <label htmlFor="photoInput" className="w-full text-center cursor-pointer bg-gray-200 text-gray-700 font-bold py-3 px-4 rounded-lg hover:bg-gray-300 inline-block">
                            Ambil Foto Bukti (Buka Kamera)
                        </label>
                        <input type="file" id="photoInput" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoChange} />
                    </div>
                    {photoPreview && <img src={photoPreview} alt="Pratinjau Foto" className="w-full rounded-lg mt-2 object-cover max-h-40" />}
                    <button onClick={handleSendReport} className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700" disabled={isSendingReport || !photoFile}>
                        {isSendingReport ? 'Mengirim...' : 'Kirim Laporan Prospek'}
                    </button>
                </div>
            </div>
            
            <CanvasingDashboard db={db} appId={appId} />
            
            {notification.show && (
                 <div className={`fixed top-5 right-5 px-6 py-3 rounded-lg text-white z-50 ${notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
                    <p>{notification.message}</p>
                </div>
            )}
        </div>
    );
};


const CanvasingDashboard = ({ db, appId }) => {
    const [attendanceData, setAttendanceData] = useState([]);
    
    useEffect(() => {
        if (db) {
            const q = query(collection(db, `artifacts/${appId}/public/data/absensi`));
            const unsubscribe = onSnapshot(q, (querySnapshot) => {
                const data = [];
                querySnapshot.forEach((doc) => {
                    data.push({ id: doc.id, ...doc.data() });
                });
                data.sort((a, b) => (b.clockInTime?.toDate() || 0) - (a.clockInTime?.toDate() || 0));
                setAttendanceData(data);
            });
            return () => unsubscribe();
        }
    }, [db, appId]);

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
            <h2 className="text-2xl font-bold text-gray-700 mb-6">Dashboard Rekap Canvasing</h2>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Karyawan</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tanggal</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Waktu Masuk/Pulang</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Laporan Prospek</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {attendanceData.length > 0 ? attendanceData.map(record => (
                            <tr key={record.id}>
                                <td className="px-6 py-4 whitespace-nowrap">{record.employeeName}</td>
                                <td className="px-6 py-4 whitespace-nowrap">{record.clockInTime?.toDate().toLocaleDateString('id-ID')}</td>
                                <td className="px-6 py-4 whitespace-nowrap">{`${record.clockInTime?.toDate().toLocaleTimeString('id-ID')} - ${record.clockOutTime ? record.clockOutTime.toDate().toLocaleTimeString('id-ID') : 'Aktif'}`}</td>
                                <td className="px-6 py-4 whitespace-nowrap">{record.journey?.filter(j => j.type === 'visit').length || 0} Laporan</td>
                            </tr>
                        )) : (
                            <tr><td colSpan="4" className="text-center py-8 text-gray-500">Tidak ada data absensi.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const CanvasingAdminDashboard = ({ db, appId, attendanceData }) => {
    const [expandedId, setExpandedId] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null); // { attendanceId, journeyIndex }

    const toggleExpand = (id) => {
        setExpandedId(expandedId === id ? null : id);
    };

    const handleDeletePhoto = async ({ attendanceId, journeyIndex }) => {
        if (!db) return;
        
        const attendanceDocRef = doc(db, `artifacts/${appId}/public/data/absensi`, attendanceId);
        try {
            const docSnap = await getDoc(attendanceDocRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                const updatedJourney = [...data.journey];
                
                if (updatedJourney[journeyIndex] && 'photo' in updatedJourney[journeyIndex]) {
                    delete updatedJourney[journeyIndex].photo;
                }

                await updateDoc(attendanceDocRef, { journey: updatedJourney });
                console.log("Photo deleted successfully");
            }
        } catch (error) {
            console.error("Error deleting photo: ", error);
        }
        setConfirmDelete(null);
    };

    const handleExport = () => {
        const date = new Date().toISOString().slice(0, 10);
        exportCanvasingToCSV(attendanceData, `laporan_canvasing_${date}`);
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-700">Laporan Canvasing Mitra</h2>
                <button 
                    onClick={handleExport}
                    className="bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 text-sm"
                >
                    Ekstrak Data Canvasing (CSV)
                </button>
            </div>
            <div className="space-y-2">
                {attendanceData.map(record => {
                    const visits = record.journey?.filter(j => j.type === 'visit') || [];
                    return (
                        <div key={record.id} className="border rounded-md">
                            <button onClick={() => toggleExpand(record.id)} className="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 flex justify-between items-center">
                                <div>
                                    <span className="font-semibold">{record.employeeName}</span>
                                    <span className="text-sm text-gray-600 ml-4">{record.clockInTime?.toDate().toLocaleDateString('id-ID')}</span>
                                </div>
                                <div className="flex items-center">
                                     <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded-full mr-4">{visits.length} Kunjungan</span>
                                     <svg className={`w-5 h-5 transition-transform ${expandedId === record.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </button>
                            {expandedId === record.id && (
                                <div className="p-4 border-t space-y-4">
                                    {visits.length > 0 ? visits.map((visit, index) => {
                                        const originalIndex = record.journey.findIndex(j => j.timestamp === visit.timestamp && j.location === visit.location);
                                        return (
                                            <div key={index} className="p-3 bg-slate-50 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div className="md:col-span-2">
                                                    <p><strong>Lokasi:</strong> {visit.location}</p>
                                                    <p><strong>Waktu:</strong> {visit.timestamp?.toDate ? visit.timestamp.toDate().toLocaleString('id-ID') : 'N/A'}</p>
                                                    <p className="text-sm text-gray-700 mt-2"><strong>Catatan:</strong> {visit.notes || '-'}</p>
                                                </div>
                                                <div>
                                                    {visit.photo ? (
                                                        <>
                                                            <img src={visit.photo} alt={`Kunjungan ke ${visit.location}`} className="rounded-md w-full h-auto object-cover" />
                                                            <button 
                                                                onClick={() => setConfirmDelete({ attendanceId: record.id, journeyIndex: originalIndex })}
                                                                className="mt-2 w-full text-xs bg-red-100 text-red-700 py-1 px-2 rounded-md hover:bg-red-200"
                                                            >
                                                                Hapus Foto
                                                            </button>
                                                        </>
                                                    ) : <p className="text-sm text-gray-500 italic">Foto telah dihapus.</p>}
                                                </div>
                                            </div>
                                        )
                                    }) : <p className="text-gray-500">Tidak ada laporan kunjungan untuk tanggal ini.</p>}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
             <ConfirmationModal
                isOpen={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={() => handleDeletePhoto(confirmDelete)}
                message="Apakah Anda yakin ingin menghapus foto ini? Tindakan ini tidak dapat diurungkan dan akan menghemat ruang penyimpanan."
            />
        </div>
    );
};


// --- Komponen Utama Aplikasi ---
export default function App() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    const [consignmentList, setConsignmentList] = useState([]);
    const [returnList, setReturnList] = useState([]);
    const [dbProducts, setDbProducts] = useState([]);
    const [dbPartners, setDbPartners] = useState([]);
    const [dbEmployees, setDbEmployees] = useState([]);
    const [attendanceData, setAttendanceData] = useState([]);
    const [adminConfig, setAdminConfig] = useState({ password: "bos123" });
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isManagerMode, setIsManagerMode] = useState(false);
    const [deleteRequest, setDeleteRequest] = useState(null);
    const [currentView, setCurrentView] = useState('main');
    
    const [filters, setFilters] = useState({
        startDate: '',
        endDate: '',
        product: '',
        partner: '',
        officer: '',
    });
    const [dataType, setDataType] = useState('dropping'); // 'dropping' or 'return'

    // Efek untuk inisialisasi Firebase dan otentikasi
    useEffect(() => {
        if (!firebaseConfig.apiKey) {
            setError("Konfigurasi Firebase tidak ditemukan.");
            setLoading(false);
            return;
        }
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const authInstance = getAuth(app);
            setDb(firestoreDb);
            setAuth(authInstance);
            setLogLevel('debug');

            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setIsAuthReady(true);
                } else {
                    try {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(authInstance, __initial_auth_token);
                        } else {
                            await signInAnonymously(authInstance);
                        }
                    } catch (authError) {
                        console.error("Authentication error:", authError);
                        setError("Gagal melakukan otentikasi. " + authError.message);
                        setIsAuthReady(true);
                    }
                }
            });
            return () => unsubscribe();
        } catch (e) {
            console.error("Firebase initialization failed:", e);
            setError("Gagal menginisialisasi aplikasi.");
            setLoading(false);
        }
    }, []);

    // Efek untuk mengambil data dari Firestore setelah otentikasi berhasil
    useEffect(() => {
        if (!isAuthReady || !db) return;

        setLoading(true);
        const collections = {
            penitipan: { path: `artifacts/${appId}/public/data/penitipan`, setter: setConsignmentList },
            pengembalian: { path: `artifacts/${appId}/public/data/pengembalian`, setter: setReturnList },
            products: { path: `artifacts/${appId}/public/data/products`, setter: setDbProducts },
            partners: { path: `artifacts/${appId}/public/data/partners`, setter: setDbPartners },
            employees: { path: `artifacts/${appId}/public/data/employees`, setter: setDbEmployees },
            absensi: { path: `artifacts/${appId}/public/data/absensi`, setter: setAttendanceData },
        };

        const unsubscribes = Object.entries(collections).map(([key, { path, setter }]) => {
            const q = query(collection(db, path));
            return onSnapshot(q, (querySnapshot) => {
                const items = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                if (key === 'penitipan' || key === 'pengembalian' || key === 'absensi') {
                    items.sort((a, b) => ((b.tanggal?.toDate() || b.clockInTime?.toDate() || 0) - (a.tanggal?.toDate() || a.clockInTime?.toDate() || 0)));
                }
                setter(items);
            }, (err) => {
                console.error(`Error fetching ${path}:`, err);
                setError(`Gagal mengambil data ${key}.`);
            });
        });

        // Fetch admin config
        const configRef = doc(db, `artifacts/${appId}/public/data/config`, 'admin');
        const unsubConfig = onSnapshot(configRef, (docSnap) => {
            if (docSnap.exists()) {
                setAdminConfig(docSnap.data());
            } else {
                // Jika config belum ada, buat dengan password default
                setDoc(configRef, { password: "bos123" });
            }
        });

        unsubscribes.push(unsubConfig);

        setLoading(false);
        return () => unsubscribes.forEach(unsub => unsub());
    }, [db, isAuthReady, appId]);

    const handleDelete = async ({id, type}) => {
        if (!db) return;
        const collectionName = type === 'dropping' ? 'penitipan' : 'pengembalian';
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/public/data/${collectionName}`, id));
            setDeleteRequest(null);
        } catch (e) {
            console.error("Error deleting document: ", e);
            setError("Gagal menghapus transaksi.");
        }
    };

    const allProducts = useMemo(() => {
        const productMap = new Map();
        INITIAL_PRODUCTS.forEach(p => productMap.set(p.name, p));
        dbProducts.forEach(p => productMap.set(p.name, {...p, id: p.id}));
        return Array.from(productMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [dbProducts]);

    const allPartners = useMemo(() => {
        const partnerMap = new Map();
        INITIAL_PARTNERS.forEach(p => partnerMap.set(p, {name: p}));
        dbPartners.forEach(p => partnerMap.set(p.name, {...p, id: p.id}));
        return Array.from(partnerMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [dbPartners]);
    
    const allEmployees = useMemo(() => {
        const employeeMap = new Map();
        INITIAL_EMPLOYEES.forEach(e => employeeMap.set(e, {name: e}));
        dbEmployees.forEach(e => employeeMap.set(e.name, {...e, id: e.id}));
        return Array.from(employeeMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [dbEmployees]);
    
    const filteredData = useMemo(() => {
        const sourceData = dataType === 'dropping' ? consignmentList : returnList;
        return sourceData.filter(item => {
            if (!item.tanggal || !item.tanggal.toDate) return false;
            const itemDate = item.tanggal.toDate();
            
            const startDate = filters.startDate ? new Date(filters.startDate) : null;
            if(startDate) startDate.setHours(0, 0, 0, 0);
            
            const endDate = filters.endDate ? new Date(filters.endDate) : null;
            if(endDate) endDate.setHours(23, 59, 59, 999);
            
            const isDateMatch = (!startDate || itemDate >= startDate) && (!endDate || itemDate <= endDate);
            const isProductMatch = !filters.product || item.namaProduk === filters.product;
            const isPartnerMatch = !filters.partner || item.namaMitra === filters.partner;
            const isOfficerMatch = !filters.officer || item.namaPetugas === filters.officer;
            
            return isDateMatch && isProductMatch && isPartnerMatch && isOfficerMatch;
        });
    }, [consignmentList, returnList, filters, dataType]);

    const handleExport = () => {
        const filename = dataType === 'dropping' ? 'laporan_dropping' : 'laporan_return';
        const date = new Date().toISOString().slice(0, 10);
        exportToCSV(filteredData, `${filename}_${date}`);
    };

    const renderView = () => {
        switch (currentView) {
            case 'dropping':
                return <ConsignmentForm db={db} appId={appId} disabled={!isAuthReady} products={allProducts} partners={allPartners} employees={allEmployees} />;
            case 'return':
                return <ReturnForm db={db} appId={appId} disabled={!isAuthReady} products={allProducts} partners={allPartners} employees={allEmployees} />;
            case 'ekstrak':
                return (
                    <div className="space-y-8">
                        <FilterAndExportPanel 
                            filters={filters}
                            setFilters={setFilters}
                            allProducts={allProducts}
                            allPartners={allPartners}
                            allEmployees={allEmployees}
                            dataToExport={filteredData}
                            onExport={handleExport}
                            dataType={dataType}
                            setDataType={setDataType}
                        />
                        <HistoryTable 
                            data={filteredData.map(d => ({...d, type: dataType}))} 
                            loading={loading} 
                            isManagerMode={isManagerMode} 
                            onDeleteRequest={setDeleteRequest}
                            title={dataType === 'dropping' ? 'Riwayat Penitipan (Dropping)' : 'Riwayat Pengembalian (Return)'}
                        />
                    </div>
                );
            case 'canvasing':
                 return <CanvasingApp db={db} appId={appId} disabled={!isAuthReady} />;
            case 'dashboard':
                return <AdminDashboardView db={db} appId={appId} disabled={!isAuthReady} onUnlock={setIsManagerMode} isManagerMode={isManagerMode} allProducts={allProducts} adminConfig={adminConfig} auth={auth} attendanceData={attendanceData}/>;
            case 'main':
            default:
                return <MainMenu setView={setCurrentView} consignmentList={consignmentList} returnList={returnList} allProducts={allProducts} />;
        }
    };

    return (
        <div className="bg-slate-100 min-h-screen font-sans p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <Header />
                {error && <ErrorMessage message={error} />}
                
                {currentView !== 'main' && (
                    <button onClick={() => setCurrentView('main')} className="mb-4 bg-gray-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-600 transition-all flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                        Kembali ke Menu Utama
                    </button>
                )}

                {loading && !error ? <p>Memuat aplikasi dan data...</p> : renderView()}

                {deleteRequest && (
                    <ConfirmationModal
                        isOpen={!!deleteRequest}
                        onClose={() => setDeleteRequest(null)}
                        onConfirm={() => handleDelete(deleteRequest)}
                        message={`Apakah Anda yakin ingin menghapus transaksi ${deleteRequest.type} untuk produk "${deleteRequest.product}" ke mitra "${deleteRequest.partner}"?`}
                    />
                )}
            </div>
        </div>
    );
}
