import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, onSnapshot, orderBy, doc, deleteDoc, updateDoc, where, getDocs } from "./firebase-init.js";

// --- GLOBAL VARIABLES ---
let currentUser = null;
let members = [];
let transactions = [];
let editingTxId = null;
let editingMemberId = null;
let financeChartInstance = null;
let memberChartInstance = null;
let ageCategoryChartInstance = null;
let ageStatusChartInstance = null;
let memberFilterState = 'active'; 
let currentTheme = localStorage.getItem('gymTheme') || 'red';

// --- IMAGE COMPRESSION HELPER ---
const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxWidth = 300; 
                const scaleSize = maxWidth / img.width;
                canvas.width = maxWidth;
                canvas.height = img.height * scaleSize;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                resolve(dataUrl);
            };
            img.onerror = (error) => reject(error);
        };
        reader.onerror = (error) => reject(error);
    });
};

// --- CUSTOM CHART PLUGIN (Horizontal Labels) ---
const dataLabelPlugin = {
    id: 'dataLabels',
    afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const isHorizontal = chart.config.options.indexAxis === 'y'; 

        chart.data.datasets.forEach((dataset, i) => {
            const meta = chart.getDatasetMeta(i);
            if (!meta.hidden) {
                meta.data.forEach((element, index) => {
                    const data = dataset.data[index];
                    if (data > 0) { 
                        ctx.fillStyle = '#ffffff';
                        const fontSize = 10;
                        const fontStyle = 'bold';
                        const fontFamily = 'Inter';
                        ctx.font = Chart.helpers.fontString(fontSize, fontStyle, fontFamily);
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        
                        const position = element.tooltipPosition();
                        let x = position.x;
                        let y = position.y;

                        if (isHorizontal) {
                            x = position.x + (dataset.stack ? -10 : 15); 
                            if(dataset.stack) ctx.fillStyle = '#fff'; 
                        } else {
                            y = position.y + (dataset.stack ? 0 : -10);
                        }
                        ctx.fillText(data.toString(), x, y); 
                    }
                });
            }
        });
    }
};

// --- NAVIGATION ---
window.switchTab = (tab) => {
    document.querySelectorAll('.view-section').forEach(e => e.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.getElementById(`view-${tab}`).style.display = 'block';
    document.getElementById(`tab-${tab}`).classList.add('active');
};

window.toggleMobileMenu = () => { console.log("Mobile menu toggled"); };

// --- AUTH ---
window.handleGoogleLogin = async () => { try { await signInWithPopup(auth, provider); } catch (e) { alert("Login Failed: " + e.message); } };
window.handleLogout = () => signOut(auth);

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById("auth-wrapper").style.display = "none";
        document.getElementById("app-wrapper").style.display = "flex";
        initApp();
    } else {
        currentUser = null;
        document.getElementById("auth-wrapper").style.display = "flex";
        document.getElementById("app-wrapper").style.display = "none";
    }
});

function initApp() {
    setTheme(currentTheme); 
    updateClock();
    setInterval(updateClock, 1000);
    setupListeners();
}

function updateClock() {
    const el = document.getElementById("clock-display");
    if(el) el.innerText = new Date().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
}

window.setTheme = (color) => {
    currentTheme = color;
    localStorage.setItem('gymTheme', color);
    const root = document.documentElement;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.theme-${color}`);
    if(activeBtn) activeBtn.classList.add('active');
    
    const colors = { 
        red: ['#ef4444','239, 68, 68'], 
        blue: ['#3b82f6','59, 130, 246'], 
        green: ['#22c55e','34, 197, 94'],
        orange: ['#f97316', '249, 115, 22']
    };
    
    if(colors[color]) {
        root.style.setProperty('--accent', colors[color][0]);
        root.style.setProperty('--accent-rgb', colors[color][1]);
        document.getElementById('meta-theme-color').content = colors[color][0];
    }
    
    if(members.length > 0) renderDashboard();
}

function setupListeners() {
    const memRef = collection(db, `gyms/${currentUser.uid}/members`);
    onSnapshot(query(memRef, orderBy("joinDate", "desc")), (snap) => {
        members = snap.docs.map(d => ({id:d.id, ...d.data()}));
        renderDashboard();
        renderMembersList(); 
        renderAgeCharts();
    });
    const txRef = collection(db, `gyms/${currentUser.uid}/transactions`);
    onSnapshot(query(txRef, orderBy("date", "desc")), (snap) => {
        transactions = snap.docs.map(d => ({id:d.id, ...d.data()}));
        renderDashboard();
        renderFinanceList();
    });
}

// --- HELPER FUNCTIONS ---
window.formatPlanDisplay = (plan) => {
    if(!plan) return '';
    if(plan.includes('d')) return plan.replace('d', ' Days');
    if(plan.includes('m')) return plan.replace('m', ' Month' + (parseInt(plan)>1?'s':''));
    if(plan.includes('y')) return plan.replace('y', ' Year' + (parseInt(plan)>1?'s':''));
    return plan + ' Months';
};

window.generateMemberID = (name, phone) => {
    const n = name ? name.replace(/\s/g, '').substring(0, 4).toUpperCase() : 'USER';
    const pStr = phone ? phone.toString().replace(/\D/g, '') : '0000';
    const p = pStr.length >= 4 ? pStr.slice(-4) : pStr.padEnd(4, '0');
    return `GYM${n}${p}`;
};

window.previewImage = (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => document.getElementById('preview-img').src = e.target.result;
        reader.readAsDataURL(input.files[0]);
    }
};

window.toggleRowAction = (id) => {
    const row = document.getElementById(`actions-${id}`);
    if (row) {
        if (row.classList.contains('show')) row.classList.remove('show');
        else row.classList.add('show');
    }
};

window.calcExpiry = () => { 
    const j = document.getElementById('inp-join').value; 
    const plan = document.getElementById('inp-plan').value; 
    if(j && plan) { 
        const d = new Date(j);
        const val = parseInt(plan);
        if(plan.includes('d')) d.setDate(d.getDate() + val);
        else if(plan.includes('y')) d.setFullYear(d.getFullYear() + val);
        else d.setMonth(d.getMonth() + val);
        document.getElementById('inp-expiry').value = d.toISOString().split('T')[0]; 
    } 
};

// --- DATA IMPORT / EXPORT FUNCTIONS (NEW FEATURE) ---

// 1. Export Data to CSV
window.exportData = (type) => {
    let dataToExport = [];
    let filename = '';

    if(type === 'members') {
        if(members.length === 0) return alert("No members to export");
        dataToExport = members.map(m => ({
            MemberID: m.memberId,
            Name: m.name,
            Phone: m.phone,
            Gender: m.gender,
            Plan: m.planDuration,
            JoinDate: m.joinDate,
            ExpiryDate: m.expiryDate,
            LastPaid: m.lastPaidAmount,
            Status: new Date(m.expiryDate) > new Date() ? 'Active' : 'Expired'
        }));
        filename = 'Gym_Members.csv';
    } else if (type === 'finance') {
        if(transactions.length === 0) return alert("No finance data to export");
        dataToExport = transactions.map(t => ({
            Date: t.date,
            Type: t.type,
            Category: t.category,
            Amount: t.amount,
            Mode: t.mode
        }));
        filename = 'Gym_Finance.csv';
    }

    const csvRows = [];
    const headers = Object.keys(dataToExport[0]);
    csvRows.push(headers.join(','));

    for (const row of dataToExport) {
        const values = headers.map(header => {
            const escaped = ('' + row[header]).replace(/"/g, '\\"');
            return `"${escaped}"`;
        });
        csvRows.push(values.join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

// 2. Import Members from CSV
window.importMembers = () => {
    const input = document.getElementById('import-file');
    const statusDiv = document.getElementById('import-status');
    
    if (!input.files || !input.files[0]) {
        return alert("Please select a CSV file first.");
    }

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
        const text = e.target.result;
        const rows = text.split('\n');
        
        if(rows.length < 2) return alert("CSV file appears empty.");

        let successCount = 0;
        statusDiv.innerText = "Processing...";
        statusDiv.style.color = "orange";

        // Start from Row 1 (Skipping Header)
        // Format: Name, Phone, Gender, JoinDate(YYYY-MM-DD), Plan(1m/3m), Amount
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',');
            if(cols.length < 5) continue; 

            const clean = (val) => val ? val.replace(/"/g, '').trim() : "";
            
            const name = clean(cols[0]);
            const phone = clean(cols[1]);
            const gender = clean(cols[2]) || 'Male';
            const joinDate = clean(cols[3]);
            const plan = clean(cols[4]);
            const amount = clean(cols[5]) || 0;

            if(name && phone && joinDate) {
                try {
                    const d = new Date(joinDate);
                    const val = parseInt(plan); 
                    if(plan.includes('d')) d.setDate(d.getDate() + val);
                    else if(plan.includes('y')) d.setFullYear(d.getFullYear() + val);
                    else d.setMonth(d.getMonth() + (val || 1)); 
                    
                    const expiryDate = d.toISOString().split('T')[0];
                    const memberId = window.generateMemberID(name, phone);

                    const docRef = await addDoc(collection(db, `gyms/${currentUser.uid}/members`), {
                        name, phone, gender, joinDate,
                        planDuration: plan,
                        expiryDate: expiryDate,
                        lastPaidAmount: amount,
                        memberId: memberId,
                        createdAt: new Date(),
                        photo: null 
                    });

                    if(amount > 0) {
                        await addFinanceEntry(`Imported - ${name}`, amount, 'Cash', joinDate, docRef.id, plan, expiryDate);
                    }

                    successCount++;
                } catch(err) {
                    console.error("Error importing row " + i, err);
                }
            }
        }

        statusDiv.innerText = `Successfully imported ${successCount} members!`;
        statusDiv.style.color = "#22c55e";
        input.value = ""; 
    };

    reader.readAsText(file);
};

// --- AUTOMATED ACCOUNTING ---
async function addFinanceEntry(category, amount, mode, date, memberId, plan, expiry) {
    try {
        await addDoc(collection(db, `gyms/${currentUser.uid}/transactions`), {
            type: 'income',
            category: category,
            amount: parseFloat(amount),
            date: date,
            mode: mode || 'Cash',
            memberId: memberId || null,
            snapshotPlan: plan || null,
            snapshotExpiry: expiry || null,
            createdAt: new Date() 
        });
    } catch(e) { console.error("Auto-finance failed", e); }
}

// --- DASHBOARD RENDERER ---
function renderDashboard() {
    if(!members.length && !transactions.length) return;
    const now = new Date().getTime();
    const txIncome = transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0);
    const txExpense = transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const memIncome = members.reduce((a, b) => a + parseInt(b.lastPaidAmount||0), 0);
    const totalRev = txIncome + memIncome;
    const formatNum = (n) => n >= 1000 ? (n/1000).toFixed(1)+'k' : n;
    
    document.getElementById("hero-clients").innerText = members.length;
    document.getElementById("hero-revenue").innerText = "₹" + formatNum(totalRev);
    document.getElementById("hero-expense").innerText = "₹" + formatNum(txExpense);

    const getStats = (minMo, maxMo) => {
        const planMembers = members.filter(m => {
            let dur = m.planDuration || "1m";
            let months = 0;
            if(dur.includes('d')) months = 0.5; 
            else if(dur.includes('y')) months = parseInt(dur) * 12;
            else months = parseInt(dur);
            return months >= minMo && months < maxMo;
        });
        const total = planMembers.length;
        const active = planMembers.filter(m => new Date(m.expiryDate).getTime() > now).length;
        const pct = total === 0 ? 0 : (active / total) * 100;
        return { active, inactive: total - active, pct };
    };
    
    const updatePlanUI = (id, label, stats) => {
        const container = document.getElementById(`row-${id}`);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const strokeDash = (stats.pct / 100) * 100; 
        if(container) {
            container.innerHTML = `
                <div class="plan-left">
                    <div class="donut-svg-wrapper">
                        <svg width="44" height="44" viewBox="0 0 40 40">
                            <circle cx="20" cy="20" r="16" fill="none" stroke="#333" stroke-width="4" />
                            <circle cx="20" cy="20" r="16" fill="none" stroke="${accent}" stroke-width="4" stroke-dasharray="${strokeDash} 100" transform="rotate(-90 20 20)" style="transition: stroke-dasharray 0.5s ease;" />
                        </svg>
                    </div>
                    <div class="plan-name">${label}</div>
                </div>
                <div class="stat-stack">
                    <div class="stat-pill"><span style="color:#fff">${stats.active}</span></div>
                    <div class="stat-pill"><span style="color:#666">${stats.inactive}</span></div>
                </div>`;
        }
    };
    
    updatePlanUI('platinum', 'Platinum<br>Membership', getStats(12, 99));
    updatePlanUI('gold', 'Gold<br>Membership', getStats(6, 12));
    updatePlanUI('silver', 'Silver<br>Membership', getStats(0, 6)); 

    updateFinanceChart(totalRev, txExpense);
    renderFilteredDashboardList();
    updateMemberChart();
}

// --- FILTER & CHARTS ---
window.setMemberFilter = (filter) => {
    memberFilterState = filter;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-filter-${filter}`).classList.add('active');
    renderFilteredDashboardList();
}

function renderFilteredDashboardList() {
    const list = document.getElementById("dash-member-list"); 
    if(!list) return;
    list.innerHTML = "";
    
    const now = new Date().getTime();
    const filtered = members.filter(m => {
        const isExpired = now > new Date(m.expiryDate).getTime();
        return memberFilterState === 'active' ? !isExpired : isExpired;
    });

    filtered.slice(0, 15).forEach(m => {
        const start = new Date(m.joinDate).getTime();
        const end = new Date(m.expiryDate).getTime();
        let pct = ((now - start) / (end - start)) * 100;
        pct = Math.min(Math.max(pct, 0), 100);
        const isExpired = now > end;
        const color = isExpired ? '#ef4444' : getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        list.innerHTML += `
            <div class="dash-row">
                <span>${m.name}</span>
                <span style="color:${isExpired?'#ef4444':'#22c55e'}">${isExpired?'Expired':'Active'}</span>
                <div class="progress-container"><div class="progress-track"><div class="progress-bar" style="width:${pct}%; background:${color}"></div></div><span class="progress-pct">${Math.floor(pct)}%</span></div>
            </div>`;
    });
}

function updateFinanceChart(rev, exp) {
    const ctx = document.getElementById('financeChart').getContext('2d');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if(financeChartInstance) financeChartInstance.destroy();
    financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels: ['Rev', 'Exp'], datasets: [{ data: [rev, exp], backgroundColor: [accent, '#fff'], borderRadius: 6, barThickness: 30 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } }, layout: { padding: { top: 20 } } }
    });
}

function updateMemberChart() {
    const ctx = document.getElementById('memberChart').getContext('2d');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const today = new Date();
    const labels = [], data = [];
    for(let i=5; i>=0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
        labels.push(d.toLocaleString('default', { month: 'short' }));
        data.push(members.filter(m => { const j=new Date(m.joinDate); return j.getMonth()===d.getMonth() && j.getFullYear()===d.getFullYear(); }).length);
    }
    if(memberChartInstance) memberChartInstance.destroy();
    memberChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: accent, borderRadius: 4, barThickness: 10 }] },
        options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 25 } }, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#888' } }, y: { display: false } } },
        plugins: [dataLabelPlugin] 
    });
}

// --- CHARTS (Horizontal) ---
function renderAgeCharts() {
    if(members.length === 0) return;
    const today = new Date();
    
    const ageBuckets = ['18-25', '25-40', '40-60', '60+'];
    const genderData = { 'Male': [0, 0, 0, 0], 'Female': [0, 0, 0, 0], 'Other': [0, 0, 0, 0] };
    const statusData = { 'Active': [0, 0, 0, 0], 'Expired': [0, 0, 0, 0] };

    members.forEach(m => {
        if(m.dob) {
            const birthDate = new Date(m.dob);
            let age = today.getFullYear() - birthDate.getFullYear();
            let bucketIndex = 3; 
            if (age >= 18 && age <= 25) bucketIndex = 0;
            else if (age > 25 && age <= 40) bucketIndex = 1;
            else if (age > 40 && age <= 60) bucketIndex = 2;

            const g = m.gender || 'Male'; 
            if(genderData[g] !== undefined) genderData[g][bucketIndex]++;
            else genderData['Other'][bucketIndex]++;

            const isActive = new Date(m.expiryDate) > today;
            if(isActive) statusData['Active'][bucketIndex]++; 
            else statusData['Expired'][bucketIndex]++;
        }
    });

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    
    const ctx1 = document.getElementById('ageCategoryChart');
    if(ctx1) {
        if(ageCategoryChartInstance) ageCategoryChartInstance.destroy();
        ageCategoryChartInstance = new Chart(ctx1.getContext('2d'), {
            type: 'bar',
            data: { 
                labels: ageBuckets, 
                datasets: [
                    { label: 'Male', data: genderData['Male'], backgroundColor: '#60a5fa', stack: 'Stack 0', borderRadius: 4 },
                    { label: 'Female', data: genderData['Female'], backgroundColor: '#f472b6', stack: 'Stack 0', borderRadius: 4 },
                    { label: 'Other', data: genderData['Other'], backgroundColor: '#9ca3af', stack: 'Stack 0', borderRadius: 4 }
                ] 
            },
            options: { 
                indexAxis: 'y', 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: {display:true, labels:{color:'#888', boxWidth:10}} }, 
                scales: { x: { display: false, grid: {display:false} }, y: { grid: {display:false}, ticks: {color:'#fff'} } } 
            },
            plugins: [dataLabelPlugin] 
        });
    }

    const ctx2 = document.getElementById('ageStatusChart');
    if(ctx2) {
        if(ageStatusChartInstance) ageStatusChartInstance.destroy();
        ageStatusChartInstance = new Chart(ctx2.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ageBuckets,
                datasets: [
                    { label: 'Active', data: statusData['Active'], backgroundColor: accent, borderRadius: 4, barThickness: 15 },
                    { label: 'Expired', data: statusData['Expired'], backgroundColor: '#333', borderRadius: 4, barThickness: 15 }
                ]
            },
            options: { 
                indexAxis: 'y',
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: {display:true, labels:{color:'#888', boxWidth:10}} }, 
                scales: { x: { display: false, grid: {display:false} }, y: { grid: {display:false}, ticks: {color:'#fff'} } } 
            },
            plugins: [dataLabelPlugin]
        });
    }
}

// --- CRUD OPERATIONS ---
window.saveMember = async () => {
    const name = document.getElementById('inp-name').value;
    const gender = document.getElementById('inp-gender').value;
    const phone = document.getElementById('inp-phone').value;
    const amount = document.getElementById('inp-amount').value;
    const dob = document.getElementById('inp-dob').value;
    const joinDate = document.getElementById('inp-join').value;
    const payMode = document.getElementById('inp-paymode').value;
    const planDuration = document.getElementById('inp-plan').value;
    const expiryDate = document.getElementById('inp-expiry').value;
    
    const fileInput = document.getElementById('inp-file');
    const file = fileInput.files ? fileInput.files[0] : null;
    
    if(!name || !amount || !dob || !joinDate) return alert("Please fill Name, Fees, Join Date and DOB");

    let photoUrl = null;
    try {
        if (file) {
            photoUrl = await compressImage(file);
        } else {
            const imgPreview = document.getElementById('preview-img');
            if (imgPreview.src && !imgPreview.src.includes('base64,PHN2')) {
                photoUrl = imgPreview.src;
            }
        }
    } catch (uploadError) {
        console.error("Compression failed", uploadError);
        alert("Image processing failed.");
    }

    const data = {
        name, gender, phone, dob, joinDate,
        expiryDate: expiryDate,
        planDuration: planDuration,
        lastPaidAmount: amount,
        photo: photoUrl 
    };

    try {
        if(editingMemberId) {
            await updateDoc(doc(db, `gyms/${currentUser.uid}/members`, editingMemberId), data);
            editingMemberId = null;
        } else {
            data.createdAt = new Date();
            data.memberId = window.generateMemberID(name, phone);
            const docRef = await addDoc(collection(db, `gyms/${currentUser.uid}/members`), data);
            await addFinanceEntry(`New Membership - ${data.name}`, amount, payMode, joinDate, docRef.id, planDuration, expiryDate);
            if(confirm("Generate Invoice?")) window.generateInvoice(data);
        }
        window.toggleMemberModal();
        fileInput.value = ""; 
    } catch (e) {
        alert("Error saving member: " + e.message);
    }
};

window.renewMember = (id) => {
    const m = members.find(x => x.id === id);
    if(!m) return;
    document.getElementById('renew-id').value = id;
    document.getElementById('renew-name').innerText = m.name;
    document.getElementById('renew-amount').value = ""; 
    document.getElementById('modal-renew').style.display = 'flex';
};

window.closeRenewModal = () => { 
    document.getElementById('modal-renew').style.display = 'none'; 
};

window.confirmRenewal = async () => {
    const id = document.getElementById('renew-id').value;
    const plan = document.getElementById('renew-plan').value;
    const amount = document.getElementById('renew-amount').value;
    const mode = document.getElementById('renew-paymode').value;
    
    if(!amount) return alert("Please enter the paid amount.");

    const m = members.find(x => x.id === id);
    if(!m) return alert("Member not found.");

    const today = new Date();
    const currentExpiry = new Date(m.expiryDate);
    const startDate = (currentExpiry > today) ? currentExpiry : today;
    
    const d = new Date(startDate);
    const val = parseInt(plan);
    if(plan.includes('d')) d.setDate(d.getDate() + val);
    else if(plan.includes('y')) d.setFullYear(d.getFullYear() + val);
    else d.setMonth(d.getMonth() + val);
    
    const newExpiry = d.toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    await updateDoc(doc(db, `gyms/${currentUser.uid}/members`, id), {
        expiryDate: newExpiry,
        lastPaidAmount: amount,
        planDuration: plan
    });

    await addFinanceEntry(`Renewal - ${m.name}`, amount, mode, todayStr, id, plan, newExpiry);

    window.closeRenewModal();
    alert(`Membership Renewed! New Expiry: ${newExpiry}`);
};

// --- HISTORY TOGGLE ---
window.toggleHistory = async (id) => {
    const panel = document.getElementById(`history-${id}`);
    if(panel.style.display === 'block') { panel.style.display = 'none'; return; }

    panel.style.display = 'block';
    panel.innerHTML = '<div style="color:#888; font-size:0.8rem;">Loading...</div>';

    const q = query(
        collection(db, `gyms/${currentUser.uid}/transactions`),
        where("memberId", "==", id),
        orderBy("date", "desc")
    );

    try {
        const snap = await getDocs(q);
        if(snap.empty) {
            panel.innerHTML = '<div style="color:#888; font-size:0.8rem;">No payment history found.</div>';
            return;
        }

        let html = `
            <table class="history-table">
                <thead><tr><th>Date</th><th>Time</th><th>Category</th><th>Mode</th><th>Amount</th><th>Action</th></tr></thead>
                <tbody>
        `;
        
        snap.forEach(doc => {
            const t = doc.data();
            const safePlan = t.snapshotPlan || '';
            const safeExpiry = t.snapshotExpiry || '';
            
            let timeStr = "-";
            if(t.createdAt && t.createdAt.seconds) {
                const dateObj = new Date(t.createdAt.seconds * 1000);
                timeStr = dateObj.toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});
            }

            html += `
                <tr>
                    <td>${t.date}</td>
                    <td style="color:#888; font-size:0.75rem;">${timeStr}</td>
                    <td>${t.category}</td>
                    <td>${t.mode || '-'}</td>
                    <td style="color:${t.type==='income'?'#22c55e':'#ef4444'}">${t.amount}</td>
                    <td><i class="fa-solid fa-print" style="cursor:pointer; color:#888;" onclick="printHistoryInvoice('${id}', '${t.amount}', '${t.date}', '${t.mode}', '${t.category}', '${safePlan}', '${safeExpiry}', '${timeStr}')"></i></td>
                </tr>`;
        });
        
        html += `</tbody></table>`;
        panel.innerHTML = html;

    } catch (e) {
        console.error(e);
        panel.innerHTML = '<div style="color:#ef4444; font-size:0.8rem;">Error loading history.</div>';
    }
};

window.printHistoryInvoice = (memberId, amount, date, mode, category, plan, expiry, timeStr) => {
    const m = members.find(x => x.id === memberId);
    if (!m) return alert("Member data missing.");

    const tempTransaction = {
        amount: amount,
        date: date,
        mode: mode,
        category: category,
        snapshotPlan: plan,
        snapshotExpiry: expiry,
        timeStr: timeStr 
    };

    window.generateInvoice(m, tempTransaction);
};

// --- UPDATED INVOICE GENERATOR (Black Header, Square Logo, Tighter Sign) ---
window.generateInvoice = async (m, specificTransaction = null) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // CHANGED: Header color to BLACK
    const themeColor = [0, 0, 0]; 
    let finalY = 0;

    const isHistory = !!specificTransaction;
    
    const amt = isHistory ? specificTransaction.amount : m.lastPaidAmount;
    const date = isHistory ? specificTransaction.date : new Date().toISOString().split('T')[0];
    const time = isHistory ? (specificTransaction.timeStr || '') : new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});
    const mode = isHistory ? specificTransaction.mode : 'Cash'; 
    const category = isHistory ? specificTransaction.category : 'Membership Fees';
    
    const rawPlan = (isHistory && specificTransaction.snapshotPlan) ? specificTransaction.snapshotPlan : m.planDuration;
    const rawExpiry = (isHistory && specificTransaction.snapshotExpiry) ? specificTransaction.snapshotExpiry : m.expiryDate;
    const planText = window.formatPlanDisplay ? window.formatPlanDisplay(rawPlan) : rawPlan;

    // --- 1. HEADER & SQUARE LOGO ---
    doc.setFillColor(...themeColor);
    // Header bar height is 25mm
    doc.rect(0, 0, 210, 25, 'F');
    
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text("THE ULTIMATE GYM 2.0", 14, 16);

    // ADD SQUARE LOGO (Right Side Top)
    try {
        const logoImg = new Image();
        logoImg.src = 'logo.png';
        // CHANGED: Sized to be square (22x22) to fit nicely within the 25mm high black header.
        // Positioned at x=175 to be on the far right.
        doc.addImage(logoImg, 'PNG', 175, 1.5, 22, 22); 
    } catch(e) { console.log("Logo error", e); }
    
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("Payment Receipt", 14, 35);
    doc.line(14, 37, 196, 37);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const receiptNo = `REC-${m.memberId}-${Math.floor(Math.random()*1000)}`;
    
    doc.text(`Receipt #: ${receiptNo}`, 14, 45);
    // Adjusted date position slightly left so it doesn't crowd the logo area
    doc.text(`Date: ${date}  ${time}`, 140, 45); 

    // --- 2. ADDRESS & CONTACT ---
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const address = "1-2-607/75/76, LIC Colony, Road, behind NTR Stadium, Ambedkar Nagar, Gandhi Nagar, Hyderabad, Telangana 500080";
    const splitAddress = doc.splitTextToSize(address, 180);
    doc.text(splitAddress, 14, 52);
    
    let currentY = 52 + (splitAddress.length * 4); 
    
    doc.text("Contact: +91 99485 92213 | +91 97052 73253", 14, currentY);
    currentY += 5; 
    doc.text("GST NO: 36CYZPA903181Z1", 14, currentY);

    // --- 3. MEMBER GRID ---
    doc.autoTable({
        startY: currentY + 10,
        theme: 'grid',
        head: [],
        body: [
            ['Member ID', m.memberId || 'N/A', 'Name', m.name],
            ['Gender', m.gender || 'N/A', 'Phone', m.phone],
            ['Duration', planText, 'Valid Until', rawExpiry], 
            ['Payment Mode', mode, 'Amount Paid', `Rs. ${amt}`]
        ],
        styles: { fontSize: 10, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.1 },
        columnStyles: {
            0: { fontStyle: 'bold', fillColor: [245, 245, 245], width: 35 },
            1: { width: 60 },
            2: { fontStyle: 'bold', fillColor: [245, 245, 245], width: 35 },
            3: { width: 60 }
        }
    });

    finalY = doc.lastAutoTable.finalY + 10;

    // --- 4. DETAILS TABLE ---
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text("Payment Details", 14, finalY);
    
    doc.autoTable({
        startY: finalY + 5,
        head: [['Description', 'Date & Time', 'Mode', 'Amount']],
        body: [
            [category, `${date} ${time}`, mode, `Rs. ${amt}`]
        ],
        theme: 'striped',
        // Header will now be black based on themeColor
        headStyles: { fillColor: themeColor },
        styles: { fontSize: 9, cellPadding: 3 }
    });

    finalY = doc.lastAutoTable.finalY + 20;

    // --- 5. SIGNATURE (Reduced Spacing) & FOOTER ---
    doc.setFontSize(10);
    doc.text("Receiver Sign:", 14, finalY);
    
    // Text baseline is at finalY
    doc.text("Authorized Signature", 150, finalY);
    
    try {
        const signImg = new Image();
        signImg.src = 'Sign.jpeg'; 
        // CHANGED: Moved Y position UP from `finalY + 2` to `finalY - 5` 
        // This pulls the image up closer to the text above it.
        doc.addImage(signImg, 'JPEG', 150, finalY - 5, 50, 25); 
    } catch(e) { console.log("Sign error", e); }

    // Left side line
    doc.line(14, finalY + 15, 60, finalY + 15);
   
    // Terms (Moved down to accommodate sign)
    finalY += 30; 
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("Note: Fees once paid are not refundable.", 14, finalY);
    doc.text("Computer Generated Receipt.", 14, finalY + 5);

    doc.save(`${m.name}_Receipt.pdf`);
};

window.toggleMemberModal = () => { 
    const el = document.getElementById('modal-member'); 
    if(el.style.display !== 'flex') {
        if(!editingMemberId) {
            document.getElementById('inp-name').value = ""; document.getElementById('inp-phone').value = "";
            document.getElementById('inp-amount').value = ""; document.getElementById('inp-dob').value = "";
            document.getElementById('inp-join').valueAsDate = new Date();
            const img = document.getElementById('preview-img');
            if(img) img.src = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzMzMyIvPjwvc3ZnPg==";
            window.calcExpiry();
        }
    } else { editingMemberId = null; }
    el.style.display = el.style.display==='flex'?'none':'flex'; 
};
window.calcExpiry = () => { const j = document.getElementById('inp-join').value; const plan = document.getElementById('inp-plan').value; if(j && plan) { const d = new Date(j); const val = parseInt(plan); if(plan.includes('d')) d.setDate(d.getDate() + val); else if(plan.includes('y')) d.setFullYear(d.getFullYear() + val); else d.setMonth(d.getMonth() + val); document.getElementById('inp-expiry').value = d.toISOString().split('T')[0]; } };
window.toggleTxModal = () => { document.getElementById('modal-transaction').style.display = document.getElementById('modal-transaction').style.display==='flex'?'none':'flex'; };
