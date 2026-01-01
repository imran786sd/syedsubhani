import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, onSnapshot, orderBy, doc, deleteDoc, updateDoc } from "./firebase-init.js";

let currentUser = null;
let members = [];
let transactions = [];
let editingTxId = null;
let financeChartInstance = null;
let memberChartInstance = null;
let memberFilterState = 'active'; 
let currentTheme = localStorage.getItem('gymTheme') || 'red';

// --- AUTH & INIT ---
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

// --- THEME SWITCHER ---
window.setTheme = (color) => {
    currentTheme = color;
    localStorage.setItem('gymTheme', color);
    const root = document.documentElement;
    
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.theme-${color}`).classList.add('active');

    switch(color) {
        case 'red':
            root.style.setProperty('--accent', '#ef4444');
            root.style.setProperty('--accent-rgb', '239, 68, 68');
            document.getElementById('meta-theme-color').content = '#ef4444';
            break;
        case 'blue':
            root.style.setProperty('--accent', '#3b82f6');
            root.style.setProperty('--accent-rgb', '59, 130, 246');
            document.getElementById('meta-theme-color').content = '#3b82f6';
            break;
        case 'green':
            root.style.setProperty('--accent', '#22c55e');
            root.style.setProperty('--accent-rgb', '34, 197, 94');
            document.getElementById('meta-theme-color').content = '#22c55e';
            break;
    }
    if(transactions.length > 0 || members.length > 0) renderDashboard();
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

    const now = new Date().getTime();

    // 1. HERO STATS
    const txIncome = transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0);
    const txExpense = transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const memIncome = members.reduce((a, b) => a + parseInt(b.lastPaidAmount||0), 0);
    const totalRev = txIncome + memIncome;

    document.getElementById("hero-clients").innerText = members.length;
    const formatNum = (n) => n >= 1000000 ? (n/1000000).toFixed(1)+'M' : (n >= 1000 ? (n/1000).toFixed(1)+'k' : n);
    document.getElementById("hero-revenue").innerText = "₹" + formatNum(totalRev);
    document.getElementById("hero-expense").innerText = "₹" + formatNum(txExpense);

    // 2. FINANCE CHART
    updateFinanceChart(totalRev, txExpense);

    // 3. MEMBERSHIPS COUNTS & DONUTS
    const getStats = (minMo, maxMo) => {
        const planMembers = members.filter(m => {
            const mo = parseInt(m.planDuration);
            return mo >= minMo && mo < maxMo;
        });
        const total = planMembers.length;
        const active = planMembers.filter(m => new Date(m.expiryDate).getTime() > now).length;
        const pct = total === 0 ? 0 : (active / total) * 100;
        return { active, total, pct };
    };

    const plat = getStats(12, 99);
    const gold = getStats(6, 12);
    const silver = getStats(0, 6);

    const updatePlanUI = (id, stats) => {
        document.getElementById(`detail-${id}`).innerText = `${stats.active} Active / ${stats.total} Total`;
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const border = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
        document.getElementById(`donut-${id}`).style.background = `conic-gradient(${accent} ${stats.pct*3.6}deg, ${border} 0deg)`;
    };

    updatePlanUI('platinum', plat);
    updatePlanUI('gold', gold);
    updatePlanUI('silver', silver);

    // 4. FILTERED LIST
    renderFilteredDashboardList();

    // 5. ACQUISITION CHART (FIXED: Now shows numbers correctly)
    updateMemberChart();
}

window.setMemberFilter = (filter) => {
    memberFilterState = filter;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-filter-${filter}`).classList.add('active');
    renderFilteredDashboardList();
}

function renderFilteredDashboardList() {
    const dashList = document.getElementById("dash-member-list");
    dashList.innerHTML = "";
    const now = new Date().getTime();

    const filteredMembers = members.filter(m => {
        const isExpired = now > new Date(m.expiryDate).getTime();
        return memberFilterState === 'active' ? !isExpired : isExpired;
    });

    filteredMembers.slice(0, 15).forEach(m => {
        const start = new Date(m.joinDate).getTime();
        const end = new Date(m.expiryDate).getTime();
        let pct = ((now - start) / (end - start)) * 100;
        pct = Math.min(Math.max(pct, 0), 100);
        const isExpired = now > end;
        const statusColor = isExpired ? '#ef4444' : '#22c55e';
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

        dashList.innerHTML += `
            <div class="dash-row">
                <span>${m.name}</span>
                <span style="color:${statusColor}">${isExpired ? 'Expired' : 'Active'}</span>
                <div class="progress-container">
                    <div class="progress-track">
                        <div class="progress-bar" style="width:${pct}%; background:${isExpired ? '#ef4444' : accentColor}"></div>
                    </div>
                    <span class="progress-pct">${Math.floor(pct)}%</span>
                </div>
            </div>
        `;
    });
}

function updateFinanceChart(rev, exp) {
    const ctx = document.getElementById('financeChart').getContext('2d');
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if(financeChartInstance) financeChartInstance.destroy();
    financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Revenue', 'Expense'],
            datasets: [{
                data: [rev, exp],
                backgroundColor: [accentColor, '#ffffff'],
                borderRadius: 8,
                borderSkipped: false,
                barThickness: 40
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display:false, grid: { display:false } } },
            layout: { padding: { top: 25 } } // Added padding here too
        }
    });
}

// --- FIXED MEMBER CHART (Padding added so numbers show) ---
function updateMemberChart() {
    const ctx = document.getElementById('memberChart').getContext('2d');
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    
    // 1. Calculate Last 6 Months Data
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const today = new Date();
    const labels = [];
    const dataPoints = [];

    for(let i=5; i>=0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthName = months[d.getMonth()];
        labels.push(monthName);

        const count = members.filter(m => {
            const join = new Date(m.joinDate);
            return join.getMonth() === d.getMonth() && join.getFullYear() === d.getFullYear();
        }).length;
        dataPoints.push(count);
    }

    const displayData = members.length > 0 ? dataPoints : [5, 8, 12, 7, 10, 15];

    if(memberChartInstance) memberChartInstance.destroy();
    
    memberChartInstance = new Chart(ctx, {
        type: 'bar', 
        data: {
            labels: labels,
            datasets: [{
                data: displayData,
                backgroundColor: accentColor,
                borderRadius: 4,
                barThickness: 12,
            }]
        },
        options: {
            responsive: true, 
            maintainAspectRatio: false,
            layout: {
                padding: { top: 25 } // <--- THIS FIXES THE CUT OFF TEXT
            },
            plugins: { legend: { display: false } },
            scales: { 
                x: { 
                    grid: { display: false },
                    ticks: { color: '#888', font: { size: 10 } }
                }, 
                y: { display: false }
            }
        },
        // DRAW NUMBERS ON TOP
        plugins: [{
            id: 'customLabels',
            afterDatasetsDraw(chart, args, options) {
                const { ctx } = chart;
                ctx.save();
                chart.data.datasets.forEach((dataset, i) => {
                    chart.getDatasetMeta(i).data.forEach((datapoint, index) => {
                        const { x, y } = datapoint;
                        const value = dataset.data[index];
                        // Always draw if value exists, even if 0
                        ctx.font = 'bold 11px Inter';
                        ctx.fillStyle = '#ffffff'; 
                        ctx.textAlign = 'center';
                        ctx.fillText(value, x, y - 5); 
                    });
                });
                ctx.restore();
            }
        }]
    });
}

// --- CRUD & LOGIC ---
window.switchTab = (tab) => {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${tab}`).style.display = 'block';
    document.getElementById(`tab-${tab}`).classList.add('active');
};
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
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
    if(el.style.display==='flex') document.getElementById('tx-date').valueAsDate = new Date();
};
window.saveTransaction = async () => {
    const type = document.getElementById('tx-type').value;
    const cat = document.getElementById('tx-category').value;
    const amt = parseFloat(document.getElementById('tx-amount').value);
    const date = document.getElementById('tx-date').value;
    if(!cat || !amt) return alert("Fill details");
    await addDoc(collection(db, `gyms/${currentUser.uid}/transactions`), { type, category: cat, amount: amt, date, createdAt: new Date() });
    toggleTxModal();
};

function renderMembersList() {
    const list = document.getElementById('members-list'); list.innerHTML = "";
    members.forEach(m => {
        list.innerHTML += `<div class="member-card"><h4>${m.name}</h4><small>${m.phone}</small></div>`;
    });
}
function renderFinanceList() {
    const list = document.getElementById('finance-list'); list.innerHTML = "";
    let profit = 0;
    transactions.forEach(t => {
        if(t.type=='income') profit+=t.amount; else profit-=t.amount;
        list.innerHTML += `<div class="member-card" style="display:flex;justify-content:space-between"><span>${t.category}</span><span style="color:${t.type=='income'?'#22c55e':'#ef4444'}">${t.type=='income'?'+':'-'} ${t.amount}</span></div>`;
    });
    document.getElementById('total-profit').innerText = "₹" + profit;
}

window.generateInvoice = (name, amount, expiry) => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
    const [r,g,b] = accentColor.split(',').map(x=>parseInt(x));
    doc.setFillColor(r,g,b); doc.rect(0,0,210,40,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(22); doc.text("GYM 2.0",105,20,null,null,"center");
    doc.setTextColor(0,0,0); doc.setFontSize(14); doc.text(`Name: ${name}\nAmount: Rs.${amount}\nValid Till: ${expiry}`,20,60);
    doc.save(`${name}_Bill.pdf`);
};
window.filterMembers = () => {
    const q = document.getElementById('member-search').value.toLowerCase();
    document.querySelectorAll('#members-list .member-card').forEach(c => c.style.display = c.innerText.toLowerCase().includes(q) ? 'block' : 'none');
};
