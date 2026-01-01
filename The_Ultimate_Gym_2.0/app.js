import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, onSnapshot, orderBy, doc, deleteDoc, updateDoc } from "./firebase-init.js";

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

// --- NAVIGATION ---
window.switchTab = (tab) => {
    document.querySelectorAll('.view-section').forEach(e => e.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.getElementById(`view-${tab}`).style.display = 'block';
    document.getElementById(`tab-${tab}`).classList.add('active');
};

// --- AUTH ---
window.handleGoogleLogin = async () => { try { await signInWithPopup(auth, provider); } catch (e) { alert(e.message); } };
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
    document.getElementById("clock-display").innerText = new Date().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
}

window.setTheme = (color) => {
    currentTheme = color;
    localStorage.setItem('gymTheme', color);
    const root = document.documentElement;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.theme-${color}`).classList.add('active');
    const colors = { red: ['#ef4444','239, 68, 68'], blue: ['#3b82f6','59, 130, 246'], green: ['#22c55e','34, 197, 94'] };
    root.style.setProperty('--accent', colors[color][0]);
    root.style.setProperty('--accent-rgb', colors[color][1]);
    document.getElementById('meta-theme-color').content = colors[color][0];
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

// --- DASHBOARD RENDERER ---
function renderDashboard() {
    if(!members.length && !transactions.length) return;
    const now = new Date().getTime();

    // 1. HERO STATS
    const txIncome = transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0);
    const txExpense = transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const memIncome = members.reduce((a, b) => a + parseInt(b.lastPaidAmount||0), 0);
    const totalRev = txIncome + memIncome;
    const formatNum = (n) => n >= 1000 ? (n/1000).toFixed(1)+'k' : n;
    
    document.getElementById("hero-clients").innerText = members.length;
    document.getElementById("hero-revenue").innerText = "₹" + formatNum(totalRev);
    document.getElementById("hero-expense").innerText = "₹" + formatNum(txExpense);

    // 2. PLANS STATS
    const getStats = (minMo, maxMo) => {
        const planMembers = members.filter(m => {
            let dur = m.planDuration || "1m";
            let months = 0;
            if(dur.includes('d')) months = 0.5; // Days count as < 1 month
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
        plugins: [{ id: 'lbl', afterDatasetsDraw(c) { const ctx=c.ctx; ctx.save(); c.data.datasets[0].data.forEach((v, i) => { const m=c.getDatasetMeta(0).data[i]; if(v>0) { ctx.font='bold 10px Inter'; ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.fillText(v, m.x, m.y-5); } }); ctx.restore(); } }]
    });
}

// --- MEMBERS TAB: AGE & STATUS CHARTS ---
function renderAgeCharts() {
    if(members.length === 0) return;
    const today = new Date();
    const ageGroups = { '18-25': 0, '25-40': 0, '40-60': 0, '60+': 0 };
    const statusByAge = { '18-25': {active:0, inactive:0}, '25-40': {active:0, inactive:0}, '40-60': {active:0, inactive:0}, '60+': {active:0, inactive:0} };

    members.forEach(m => {
        if(m.dob) {
            const birthDate = new Date(m.dob);
            let age = today.getFullYear() - birthDate.getFullYear();
            let group = '60+';
            if (age >= 18 && age <= 25) group = '18-25';
            else if (age > 25 && age <= 40) group = '25-40';
            else if (age > 40 && age <= 60) group = '40-60';

            ageGroups[group]++;
            const isActive = new Date(m.expiryDate) > today;
            if(isActive) statusByAge[group].active++; else statusByAge[group].inactive++;
        }
    });

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    
    const ctx1 = document.getElementById('ageCategoryChart');
    if(ctx1) {
        if(ageCategoryChartInstance) ageCategoryChartInstance.destroy();
        ageCategoryChartInstance = new Chart(ctx1.getContext('2d'), {
            type: 'bar',
            data: { labels: Object.keys(ageGroups), datasets: [{ label: 'Members', data: Object.values(ageGroups), backgroundColor: accent, borderRadius: 4, barThickness: 20 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: {display:false} }, scales: { x: { grid: {display:false}, ticks: {color:'#888'} }, y: { display:false } } }
        });
    }

    const ctx2 = document.getElementById('ageStatusChart');
    if(ctx2) {
        if(ageStatusChartInstance) ageStatusChartInstance.destroy();
        ageStatusChartInstance = new Chart(ctx2.getContext('2d'), {
            type: 'bar',
            data: {
                labels: Object.keys(statusByAge),
                datasets: [
                    { label: 'Active', data: Object.values(statusByAge).map(x=>x.active), backgroundColor: accent, borderRadius: 4, barThickness: 10 },
                    { label: 'Expired', data: Object.values(statusByAge).map(x=>x.inactive), backgroundColor: '#444', borderRadius: 4, barThickness: 10 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: {display:true, labels:{color:'#888', boxWidth:10}} }, scales: { x: { grid: {display:false}, ticks: {color:'#888'} }, y: { display:false } } }
        });
    }
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

window.toggleMobileMenu = () => {
    // Basic placeholder for now
    console.log("Mobile menu toggled");
};

// --- CRUD OPERATIONS ---
window.saveMember = async () => {
    const name = document.getElementById('inp-name').value;
    const phone = document.getElementById('inp-phone').value;
    const amount = document.getElementById('inp-amount').value;
    const dob = document.getElementById('inp-dob').value;
    const joinDate = document.getElementById('inp-join').value;
    const imgEl = document.getElementById('preview-img');
    const imgSrc = imgEl ? imgEl.src : "";
    
    if(!name || !amount || !dob || !joinDate) return alert("Please fill Name, Fees, Join Date and DOB");

    const finalPhoto = (imgSrc && imgSrc.includes('base64')) ? imgSrc : null;

    const data = {
        name, phone, dob, joinDate,
        expiryDate: document.getElementById('inp-expiry').value,
        planDuration: document.getElementById('inp-plan').value,
        lastPaidAmount: amount,
        photo: finalPhoto
    };

    try {
        if(editingMemberId) {
            await updateDoc(doc(db, `gyms/${currentUser.uid}/members`, editingMemberId), data);
            editingMemberId = null;
        } else {
            data.createdAt = new Date();
            data.memberId = window.generateMemberID(name, phone);
            await addDoc(collection(db, `gyms/${currentUser.uid}/members`), data);
            if(confirm("Generate Invoice?")) window.generateInvoice(data);
        }
        window.toggleMemberModal();
    } catch (e) {
        console.error(e);
        alert("Error saving member. If you uploaded a photo, it might be too large.");
    }
};

window.editMember = (id) => {
    const m = members.find(x => x.id === id); if(!m) return;
    editingMemberId = id;
    document.getElementById('inp-name').value = m.name; 
    document.getElementById('inp-phone').value = m.phone; 
    document.getElementById('inp-amount').value = m.lastPaidAmount; 
    document.getElementById('inp-dob').value = m.dob;
    document.getElementById('inp-join').value = m.joinDate; 
    document.getElementById('inp-expiry').value = m.expiryDate; 
    document.getElementById('inp-plan').value = m.planDuration || "1m";
    
    const preview = document.getElementById('preview-img');
    if(preview) preview.src = m.photo || "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzMzMyIvPjwvc3ZnPg==";
    
    document.getElementById('modal-member').style.display = 'flex';
};

window.deleteMember = async (id) => { if(confirm("Delete member?")) await deleteDoc(doc(db, `gyms/${currentUser.uid}/members`, id)); };

window.renewMember = (id) => {
    window.editMember(id); 
    alert("Update the Join Date and Payment to Renew.");
};

window.saveTransaction = async () => {
    const type = document.getElementById('tx-type').value; const cat = document.getElementById('tx-category').value; const amt = parseFloat(document.getElementById('tx-amount').value);
    const date = document.getElementById('tx-date').value;
    if(!cat || !amt) return alert("Fill details");
    const data = { type, category: cat, amount: amt, date };
    if(editingTxId) { await updateDoc(doc(db, `gyms/${currentUser.uid}/transactions`, editingTxId), data); editingTxId = null; }
    else { data.createdAt = new Date(); await addDoc(collection(db, `gyms/${currentUser.uid}/transactions`), data); }
    window.toggleTxModal();
};

window.editTransaction = (id) => {
    const t = transactions.find(x => x.id === id); if(!t) return;
    editingTxId = id;
    document.getElementById('tx-type').value = t.type; document.getElementById('tx-category').value = t.category; document.getElementById('tx-amount').value = t.amount; document.getElementById('tx-date').value = t.date;
    document.getElementById('modal-transaction').style.display = 'flex';
};

window.deleteTransaction = async (id) => { if(confirm("Delete transaction?")) await deleteDoc(doc(db, `gyms/${currentUser.uid}/transactions`, id)); };

window.sendWhatsApp = (phone, name, expiry) => {
    let p = phone ? phone.replace(/\D/g,'') : ''; 
    if(p.length===10) p="91"+p;
    if(p) window.open(`https://wa.me/${p}?text=Hello ${name}, your gym membership expires on ${expiry}.`, '_blank');
    else alert("Invalid phone number");
}

function renderMembersList() {
    const list = document.getElementById('members-list'); 
    if(!list) return;
    list.innerHTML = "";
    const today = new Date();

    members.forEach(m => {
        const expDate = new Date(m.expiryDate);
        const daysLeft = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
        let statusClass = 'status-paid'; let statusText = 'Paid';
        if (daysLeft < 0) { statusClass = 'status-due'; statusText = 'Expired'; }
        else if (daysLeft < 5) { statusClass = 'status-pending'; statusText = `Due in ${daysLeft} days`; }

        const placeholder = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzMzMyIvPjwvc3ZnPg==";
        const photoUrl = m.photo || placeholder;
        const planDisplay = window.formatPlanDisplay(m.planDuration);

        list.innerHTML += `
        <div class="member-row">
            <i class="fa-solid fa-ellipsis-vertical mobile-kebab-btn" onclick="toggleRowAction('${m.id}')"></i>
            <div class="profile-img-container"><img src="${photoUrl}" class="profile-circle" onclick="editMember('${m.id}')"></div>
            <div class="info-block">
                <div class="member-id-tag">${m.memberId || 'PENDING'}</div>
                <div class="name-phone-row">
                    <span class="info-main">${m.name}</span>
                    <span style="font-weight:400; font-size:0.8rem; color:#888;">${m.phone}</span>
                </div>
            </div>
            <div class="info-block"><div class="info-main">${m.joinDate}</div><div class="info-sub">${planDisplay} Plan</div></div>
            <div><span class="status-badge ${statusClass}">${statusText}</span></div>
            <div class="row-actions" id="actions-${m.id}">
                <div class="icon-btn" onclick="renewMember('${m.id}')" title="Renew"><i class="fa-solid fa-arrows-rotate"></i></div>
                <div class="icon-btn" onclick="editMember('${m.id}')" title="Edit"><i class="fa-solid fa-pen"></i></div>
                <div class="icon-btn whatsapp" onclick="sendWhatsApp('${m.phone}', '${m.name}', '${m.expiryDate}')" title="Chat"><i class="fa-brands fa-whatsapp"></i></div>
                <div class="icon-btn bill" onclick='generateInvoice(${JSON.stringify(m)})' title="Bill"><i class="fa-solid fa-file-invoice"></i></div>
                <div class="icon-btn delete" onclick="deleteMember('${m.id}')" title="Delete"><i class="fa-solid fa-trash"></i></div>
            </div>
        </div>`;
    });
}

// ... (Other functions: toggleMemberModal, calcExpiry, etc.) ...
window.filterMembers = () => { const q = document.getElementById('member-search').value.toLowerCase(); document.querySelectorAll('.member-row').forEach(c => c.style.display = c.innerText.toLowerCase().includes(q) ? 'grid' : 'none'); };
window.generateInvoice = (m) => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    const primaryColor = [239, 68, 68];
    doc.setFillColor(...primaryColor); doc.rect(0, 0, 210, 40, 'F');
    doc.setFontSize(22); doc.setTextColor(255, 255, 255); doc.text("GYM RECEIPT", 105, 25, null, null, "center");
    doc.setTextColor(0, 0, 0); doc.setFontSize(10);
    doc.text(`Receipt #: ${Math.floor(Math.random()*10000)}`, 14, 50);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 150, 50);
    doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text("Member Details:", 14, 60);
    doc.setFont(undefined, 'normal'); doc.setFontSize(10);
    doc.text(`Name: ${m.name}`, 14, 66); doc.text(`ID: ${m.memberId || 'N/A'}`, 14, 71);
    doc.text(`Phone: ${m.phone}`, 14, 76); doc.text(`Valid Until: ${m.expiryDate}`, 14, 81);
    const planText = window.formatPlanDisplay(m.planDuration);
    doc.autoTable({ startY: 90, head: [['Description', 'Duration', 'Amount']], body: [[`Gym Membership`, planText, `Rs. ${m.lastPaidAmount}`]], theme: 'grid', headStyles: { fillColor: primaryColor } });
    doc.save(`${m.name}_Invoice.pdf`);
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
function renderFinanceList() { const l=document.getElementById('finance-list'); l.innerHTML=''; let p=0; transactions.forEach(t=>{ if(t.type=='income') p+=t.amount; else p-=t.amount; l.innerHTML+=`<div class="member-card" style="display:flex;justify-content:space-between; align-items:center;"><div><span style="font-weight:600; display:block;">${t.category}</span><small style="color:#888">${t.date}</small></div><div style="display:flex; gap:15px; align-items:center;"><span style="color:${t.type=='income'?'#22c55e':'#ef4444'}; font-weight:bold;">${t.type=='income'?'+':'-'} ${t.amount}</span><div style="display:flex; gap:10px;"><i class="fa-solid fa-pen" style="cursor:pointer; color:#888" onclick="editTransaction('${t.id}')"></i><i class="fa-solid fa-trash" style="cursor:pointer; color:#ef4444" onclick="deleteTransaction('${t.id}')"></i></div></div></div>`; }); document.getElementById('total-profit').innerText="₹"+p; }
