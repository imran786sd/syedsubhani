import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, onSnapshot, orderBy, doc, deleteDoc, updateDoc } from "./firebase-init.js";

let currentUser = null;
let members = [];
let transactions = [];
let editingTxId = null;
let financeChartInstance = null;
let memberChartInstance = null;

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
    updateClock();
    setInterval(updateClock, 1000);
    setupListeners();
}
function updateClock() {
    document.getElementById("clock-display").innerText = new Date().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
}

// --- DB LISTENERS ---
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

// --- DASHBOARD RENDERER ---
function renderDashboard() {
    if(!members.length && !transactions.length) return;

    // 1. HERO STATS
    const txIncome = transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0);
    const txExpense = transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const memIncome = members.reduce((a, b) => a + parseInt(b.lastPaidAmount||0), 0);
    const totalRev = txIncome + memIncome;

    document.getElementById("hero-clients").innerText = members.length;
    document.getElementById("hero-revenue").innerText = "₹" + (totalRev/1000).toFixed(1) + "k";
    document.getElementById("hero-expense").innerText = "₹" + (txExpense/1000).toFixed(1) + "k";

    // 2. FINANCE CHART & SUMMARY
    document.getElementById("fin-rev-num").innerText = (totalRev/1000).toFixed(1)+"k";
    document.getElementById("fin-exp-num").innerText = (txExpense/1000).toFixed(1)+"k";
    document.getElementById("fin-prof-num").innerText = ((totalRev-txExpense)/1000).toFixed(1)+"k";
    updateFinanceChart(totalRev, txExpense);

    // 3. MEMBERSHIPS COUNTS
    document.getElementById("count-platinum").innerText = members.filter(m => parseInt(m.planDuration) >= 12).length;
    document.getElementById("count-gold").innerText = members.filter(m => parseInt(m.planDuration) >= 6 && parseInt(m.planDuration) < 12).length;
    document.getElementById("count-silver").innerText = members.filter(m => parseInt(m.planDuration) < 6).length;

    // 4. MEMBER LIST (STATUS)
    const dashList = document.getElementById("dash-member-list");
    dashList.innerHTML = "";
    members.slice(0, 10).forEach(m => {
        const start = new Date(m.joinDate).getTime();
        const end = new Date(m.expiryDate).getTime();
        const now = new Date().getTime();
        let pct = ((now - start) / (end - start)) * 100;
        pct = Math.min(Math.max(pct, 0), 100);
        const isExpired = now > end;

        dashList.innerHTML += `
            <div class="dash-row">
                <span>${m.name}</span>
                <span style="color:${isExpired ? '#ef4444' : '#22c55e'}">${isExpired ? 'Expired' : 'Active'}</span>
                <div class="progress-track"><div class="progress-bar" style="width:${pct}%; background:${isExpired?'#ef4444':'#f97316'}"></div></div>
            </div>
        `;
    });

    // 5. ACQUISITION CHART
    updateMemberChart();
}

function updateFinanceChart(rev, exp) {
    const ctx = document.getElementById('financeChart').getContext('2d');
    if(financeChartInstance) financeChartInstance.destroy();
    financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Current Month'],
            datasets: [
                { label: 'Rev', data: [rev], backgroundColor: '#fff', borderRadius: 4, barThickness: 25 },
                { label: 'Exp', data: [exp], backgroundColor: '#f97316', borderRadius: 4, barThickness: 25 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { grid: { color: '#333' }, ticks: { color: '#666' } } }
        }
    });
}

function updateMemberChart() {
    const ctx = document.getElementById('memberChart').getContext('2d');
    // Generating dummy trend based on existing member count
    const count = members.length;
    const data = [Math.floor(count*0.2), Math.floor(count*0.4), Math.floor(count*0.6), Math.floor(count*0.8), count];
    
    if(memberChartInstance) memberChartInstance.destroy();
    memberChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['1', '2', '3', '4', '5'],
            datasets: [{ data: data, backgroundColor: '#f97316', borderRadius: 2, barThickness: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: false } }
        }
    });
}

// --- CRUD & LOGIC ---
window.switchTab = (tab) => {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-menu span').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${tab}`).style.display = 'block';
    const btn = document.getElementById(`tab-${tab}`);
    if(btn) btn.classList.add('active');
};
window.toggleMobileMenu = () => {
    document.querySelector('.nav-menu').classList.toggle('mobile-open');
}

window.toggleMemberModal = () => {
    const el = document.getElementById('modal-member');
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
    if(el.style.display==='flex') document.getElementById('inp-join').valueAsDate = new Date();
};

window.calcExpiry = () => {
    const j = document.getElementById('inp-join').value;
    const m = parseInt(document.getElementById('inp-plan').value);
    if(j) {
        const d = new Date(j); d.setMonth(d.getMonth() + m);
        document.getElementById('inp-expiry').value = d.toISOString().split('T')[0];
    }
};

window.saveMember = async () => {
    const name = document.getElementById('inp-name').value;
    const phone = document.getElementById('inp-phone').value;
    const amount = document.getElementById('inp-amount').value;
    if(!name || !amount) return alert("Fill Name and Fees");
    
    await addDoc(collection(db, `gyms/${currentUser.uid}/members`), {
        name, phone, joinDate: document.getElementById('inp-join').value,
        expiryDate: document.getElementById('inp-expiry').value,
        planDuration: document.getElementById('inp-plan').value,
        lastPaidAmount: amount
    });
    toggleMemberModal();
    if(confirm("Download Bill?")) generateInvoice(name, amount, document.getElementById('inp-expiry').value);
};

window.toggleTxModal = () => {
    const el = document.getElementById('modal-transaction');
    if(el.style.display === 'flex') {
        el.style.display = 'none'; editingTxId = null;
        document.getElementById('tx-category').value = "";
        document.getElementById('tx-amount').value = "";
    } else {
        el.style.display = 'flex';
        document.getElementById('tx-date').valueAsDate = new Date();
    }
};

window.saveTransaction = async () => {
    const type = document.getElementById('tx-type').value;
    const cat = document.getElementById('tx-category').value;
    const amt = parseFloat(document.getElementById('tx-amount').value);
    const date = document.getElementById('tx-date').value;
    
    if(!cat || !amt) return alert("Fill details");
    
    if(editingTxId) {
        await updateDoc(doc(db, `gyms/${currentUser.uid}/transactions`, editingTxId), { type, category: cat, amount: amt, date });
        editingTxId = null;
    } else {
        await addDoc(collection(db, `gyms/${currentUser.uid}/transactions`), { type, category: cat, amount: amt, date, createdAt: new Date() });
    }
    toggleTxModal();
};

window.deleteTx = async (id) => { if(confirm("Delete?")) await deleteDoc(doc(db, `gyms/${currentUser.uid}/transactions`, id)); };
window.editTx = (id) => {
    const t = transactions.find(x => x.id === id);
    if(!t) return;
    editingTxId = id;
    document.getElementById('tx-type').value = t.type;
    document.getElementById('tx-date').value = t.date;
    document.getElementById('tx-category').value = t.category;
    document.getElementById('tx-amount').value = t.amount;
    document.getElementById('modal-transaction').style.display = 'flex';
};

// --- RENDER LISTS ---
function renderMembersList() {
    const list = document.getElementById('members-list'); list.innerHTML = "";
    members.forEach(m => {
        list.innerHTML += `
        <div class="member-card">
            <div style="display:flex; justify-content:space-between">
                <h4>${m.name}</h4>
                <button onclick="window.open('https://wa.me/91${m.phone}?text=Reminder', '_blank')" style="background:none;border:none;color:#22c55e;cursor:pointer"><i class="fa-brands fa-whatsapp"></i></button>
            </div>
            <small style="color:#888">${m.expiryDate}</small>
        </div>`;
    });
}
function renderFinanceList() {
    const list = document.getElementById('finance-list'); list.innerHTML = "";
    transactions.forEach(t => {
        list.innerHTML += `
        <div class="member-card">
            <div><strong>${t.category}</strong> <br><small>${t.date}</small></div>
            <div style="text-align:right">
                <span style="color:${t.type=='income'?'#22c55e':'#ef4444'}">${t.type=='income'?'+':'-'} ${t.amount}</span><br>
                <i class="fa-solid fa-pen" onclick="editTx('${t.id}')" style="color:#666;cursor:pointer;margin-right:10px"></i>
                <i class="fa-solid fa-trash" onclick="deleteTx('${t.id}')" style="color:#666;cursor:pointer"></i>
            </div>
        </div>`;
    });
}

// --- PDF INVOICE ---
window.generateInvoice = (name, amount, expiry) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFillColor(249, 115, 22); doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(22); doc.text("GYM 2.0", 105, 20, null, null, "center");
    doc.setTextColor(0, 0, 0); doc.setFontSize(14);
    let y = 60;
    doc.text(`Name: ${name}`, 20, y); y+=10;
    doc.text(`Amount: Rs.${amount}`, 20, y); y+=10;
    doc.text(`Valid Till: ${expiry}`, 20, y);
    doc.save(`${name}_Bill.pdf`);
};

window.filterMembers = () => {
    const q = document.getElementById('member-search').value.toLowerCase();
    document.querySelectorAll('#members-list .member-card').forEach(c => {
        c.style.display = c.innerText.toLowerCase().includes(q) ? 'block' : 'none';
    });
};
