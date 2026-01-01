import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, onSnapshot, orderBy, doc, deleteDoc, updateDoc } from "./firebase-init.js";

let currentUser = null;
let members = [];
let transactions = [];
let editingTxId = null;
let editingMemberId = null;
let financeChartInstance = null;
let memberChartInstance = null;
let memberFilterState = 'active'; 
let currentTheme = localStorage.getItem('gymTheme') || 'red';

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
    if(transactions.length > 0 || members.length > 0) renderDashboard();
}

function setupListeners() {
    const memRef = collection(db, `gyms/${currentUser.uid}/members`);
    onSnapshot(query(memRef, orderBy("joinDate", "desc")), (snap) => {
        members = snap.docs.map(d => ({id:d.id, ...d.data()}));
        renderDashboard();
        renderMembersList();
    });
    const txRef = collection(db, `gyms/${currentUser.uid}/transactions`);
    onSnapshot(query(txRef, orderBy("date", "desc")), (snap) => {
        transactions = snap.docs.map(d => ({id:d.id, ...d.data()}));
        renderDashboard();
        renderFinanceList();
    });
}

function renderDashboard() {
    if(!members.length && !transactions.length) return;
    const now = new Date().getTime();

    // 1. HERO
    const txIncome = transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0);
    const txExpense = transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const memIncome = members.reduce((a, b) => a + parseInt(b.lastPaidAmount||0), 0);
    const totalRev = txIncome + memIncome;
    const formatNum = (n) => n >= 1000000 ? (n/1000000).toFixed(1)+'M' : (n >= 1000 ? (n/1000).toFixed(1)+'k' : n);
    document.getElementById("hero-clients").innerText = members.length;
    document.getElementById("hero-revenue").innerText = "₹" + formatNum(totalRev);
    document.getElementById("hero-expense").innerText = "₹" + formatNum(txExpense);

    // 2. PLANS
    const getStats = (minMo, maxMo) => {
        const planMembers = members.filter(m => {
            const mo = parseInt(m.planDuration);
            return mo >= minMo && mo < maxMo;
        });
        const total = planMembers.length;
        const active = planMembers.filter(m => new Date(m.expiryDate).getTime() > now).length;
        const inactive = total - active; 
        const pct = total === 0 ? 0 : (active / total) * 100;
        return { active, inactive, total, pct };
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

window.setMemberFilter = (filter) => {
    memberFilterState = filter;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-filter-${filter}`).classList.add('active');
    renderFilteredDashboardList();
}

function renderFilteredDashboardList() {
    const list = document.getElementById("dash-member-list"); list.innerHTML = "";
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
    const displayData = members.length > 0 ? data : [5, 8, 12, 7, 10, 15];
    if(memberChartInstance) memberChartInstance.destroy();
    memberChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: displayData, backgroundColor: accent, borderRadius: 4, barThickness: 10 }] },
        options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 25 } }, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#888' } }, y: { display: false } } },
        plugins: [{ id: 'lbl', afterDatasetsDraw(c) { const ctx=c.ctx; ctx.save(); c.data.datasets[0].data.forEach((v, i) => { const m=c.getDatasetMeta(0).data[i]; if(v>0) { ctx.font='bold 10px Inter'; ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.fillText(v, m.x, m.y-5); } }); ctx.restore(); } }]
    });
}

// --- CRUD ---
window.switchTab = (tab) => {
    document.querySelectorAll('.view-section').forEach(e => e.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.getElementById(`view-${tab}`).style.display = 'block';
    document.getElementById(`tab-${tab}`).classList.add('active');
};
window.toggleMemberModal = () => { 
    const el = document.getElementById('modal-member'); 
    if(el.style.display !== 'flex') {
        if(!editingMemberId) {
            document.getElementById('inp-name').value = ""; document.getElementById('inp-phone').value = "";
            document.getElementById('inp-amount').value = ""; document.getElementById('inp-join').valueAsDate = new Date();
            window.calcExpiry();
        }
    } else { editingMemberId = null; }
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex'; 
};
window.toggleTxModal = () => { 
    const el = document.getElementById('modal-transaction'); 
    if(el.style.display !== 'flex') {
        if(!editingTxId) {
            document.getElementById('tx-amount').value = ""; document.getElementById('tx-category').value = ""; document.getElementById('tx-date').valueAsDate = new Date();
        }
    } else { editingTxId = null; }
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex'; 
};

window.calcExpiry = () => { 
    const j = document.getElementById('inp-join').value; 
    const m = parseInt(document.getElementById('inp-plan').value); 
    if(j) { const d = new Date(j); d.setMonth(d.getMonth() + m); document.getElementById('inp-expiry').value = d.toISOString().split('T')[0]; } 
};

window.saveMember = async () => {
    const name = document.getElementById('inp-name').value; const phone = document.getElementById('inp-phone').value; const amount = document.getElementById('inp-amount').value;
    if(!name || !amount) return alert("Fill Name and Fees");
    const data = { name, phone, joinDate: document.getElementById('inp-join').value, expiryDate: document.getElementById('inp-expiry').value, planDuration: document.getElementById('inp-plan').value, lastPaidAmount: amount };
    if(editingMemberId) { await updateDoc(doc(db, `gyms/${currentUser.uid}/members`, editingMemberId), data); editingMemberId = null; }
    else { data.createdAt = new Date(); await addDoc(collection(db, `gyms/${currentUser.uid}/members`), data); if(confirm("Download Bill?")) generateInvoice(name, amount, data.expiryDate); }
    toggleMemberModal();
};

window.editMember = (id) => {
    const m = members.find(x => x.id === id); if(!m) return;
    editingMemberId = id;
    document.getElementById('inp-name').value = m.name; document.getElementById('inp-phone').value = m.phone; document.getElementById('inp-amount').value = m.lastPaidAmount;
    document.getElementById('inp-join').value = m.joinDate; document.getElementById('inp-expiry').value = m.expiryDate; document.getElementById('inp-plan').value = m.planDuration||1;
    document.getElementById('modal-member').style.display = 'flex';
};

window.deleteMember = async (id) => { if(confirm("Delete member?")) await deleteDoc(doc(db, `gyms/${currentUser.uid}/members`, id)); };

window.saveTransaction = async () => {
    const type = document.getElementById('tx-type').value; const cat = document.getElementById('tx-category').value; const amt = parseFloat(document.getElementById('tx-amount').value);
    const date = document.getElementById('tx-date').value;
    if(!cat || !amt) return alert("Fill details");
    const data = { type, category: cat, amount: amt, date };
    if(editingTxId) { await updateDoc(doc(db, `gyms/${currentUser.uid}/transactions`, editingTxId), data); editingTxId = null; }
    else { data.createdAt = new Date(); await addDoc(collection(db, `gyms/${currentUser.uid}/transactions`), data); }
    toggleTxModal();
};

window.editTransaction = (id) => {
    const t = transactions.find(x => x.id === id); if(!t) return;
    editingTxId = id;
    document.getElementById('tx-type').value = t.type; document.getElementById('tx-category').value = t.category; document.getElementById('tx-amount').value = t.amount; document.getElementById('tx-date').value = t.date;
    document.getElementById('modal-transaction').style.display = 'flex';
};

window.deleteTransaction = async (id) => { if(confirm("Delete transaction?")) await deleteDoc(doc(db, `gyms/${currentUser.uid}/transactions`, id)); };

window.sendWhatsApp = (phone, name, expiry) => {
    let p = phone.replace(/\D/g,''); if(p.length===10) p="91"+p;
    window.open(`https://wa.me/${p}?text=Hello ${name}, your gym membership expires on ${expiry}.`, '_blank');
}

function renderMembersList() {
    const list = document.getElementById('members-list'); list.innerHTML = "";
    const today = new Date().toISOString().split('T')[0];
    members.forEach(m => {
        const isExpired = m.expiryDate < today;
        const color = isExpired ? '#ef4444' : '#22c55e';
        list.innerHTML += `
        <div class="member-card">
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                <div><h4 style="margin:0; font-size:1.1rem;">${m.name}</h4><small style="color:#888;">${m.phone}</small></div>
                <div style="text-align:right;"><small style="display:block; color:#888;">Expires</small><span style="font-weight:bold; color:${color}">${m.expiryDate}</span></div>
            </div>
            <div class="action-btn-group">
                <div class="action-btn" onclick="editMember('${m.id}')"><i class="fa-solid fa-pen"></i> Edit</div>
                <div class="action-btn btn-whatsapp" onclick="sendWhatsApp('${m.phone}', '${m.name}', '${m.expiryDate}')"><i class="fa-brands fa-whatsapp"></i> Chat</div>
                <div class="action-btn" onclick="generateInvoice('${m.name}', '${m.lastPaidAmount}', '${m.expiryDate}')"><i class="fa-solid fa-file-invoice"></i> Bill</div>
                <div class="action-btn btn-delete" onclick="deleteMember('${m.id}')"><i class="fa-solid fa-trash"></i></div>
            </div>
        </div>`;
    });
}

function renderFinanceList() { 
    const list = document.getElementById('finance-list'); list.innerHTML = ""; 
    let profit = 0; 
    transactions.forEach(t => { 
        if(t.type=='income') profit+=t.amount; else profit-=t.amount; 
        list.innerHTML += `
        <div class="member-card" style="display:flex;justify-content:space-between; align-items:center;">
            <div><span style="font-weight:600; display:block;">${t.category}</span><small style="color:#888">${t.date}</small></div>
            <div style="display:flex; gap:15px; align-items:center;">
                <span style="color:${t.type=='income'?'#22c55e':'#ef4444'}; font-weight:bold;">${t.type=='income'?'+':'-'} ${t.amount}</span>
                <div style="display:flex; gap:10px;">
                    <i class="fa-solid fa-pen" style="cursor:pointer; color:#888" onclick="editTransaction('${t.id}')"></i>
                    <i class="fa-solid fa-trash" style="cursor:pointer; color:#ef4444" onclick="deleteTransaction('${t.id}')"></i>
                </div>
            </div>
        </div>`; 
    }); 
    document.getElementById('total-profit').innerText = "₹" + profit; 
}

window.generateInvoice = (name, amount, expiry) => { const { jsPDF } = window.jspdf; const doc = new jsPDF(); const col = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim().split(',').map(x=>parseInt(x)); doc.setFillColor(col[0],col[1],col[2]); doc.rect(0,0,210,40,'F'); doc.setTextColor(255,255,255); doc.setFontSize(22); doc.text("GYM 2.0",105,20,null,null,"center"); doc.setTextColor(0,0,0); doc.setFontSize(14); doc.text(`Name: ${name}\nAmount: Rs.${amount}\nValid Till: ${expiry}`,20,60); doc.save(`${name}_Bill.pdf`); };
window.filterMembers = () => { const q = document.getElementById('member-search').value.toLowerCase(); document.querySelectorAll('#members-list .member-card').forEach(c => c.style.display = c.innerText.toLowerCase().includes(q) ? 'block' : 'none'); };
