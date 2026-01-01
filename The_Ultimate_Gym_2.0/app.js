import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, onSnapshot, orderBy, doc, deleteDoc, updateDoc } from "./firebase-init.js";

let currentUser = null;
let members = [];
let transactions = [];
let editingTxId = null;
let editingMemberId = null;
let financeChartInstance = null;
let memberChartInstance = null;
let ageCategoryChartInstance = null;
let ageStatusChartInstance = null;
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
    if(members.length > 0) renderDashboard();
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

// --- DASHBOARD LOGIC ---
function renderDashboard() {
    if(!members.length && !transactions.length) return;
    
    // 1. HERO & FINANCE
    const txIncome = transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0);
    const txExpense = transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const memIncome = members.reduce((a, b) => a + parseInt(b.lastPaidAmount||0), 0);
    const totalRev = txIncome + memIncome;
    const formatNum = (n) => n >= 1000 ? (n/1000).toFixed(1)+'k' : n;
    
    document.getElementById("hero-clients").innerText = members.length;
    document.getElementById("hero-revenue").innerText = "₹" + formatNum(totalRev);
    document.getElementById("hero-expense").innerText = "₹" + formatNum(txExpense);
    
    updateFinanceChart(totalRev, txExpense);
    updateMemberChart(); // Acquisition
    
    // 2. AGE & CATEGORY CHARTS
    renderAgeCharts();
}

function renderAgeCharts() {
    const today = new Date();
    const ageGroups = { '18-25': 0, '25-40': 0, '40-60': 0, '60+': 0 };
    const statusByAge = { '18-25': {active:0, inactive:0}, '25-40': {active:0, inactive:0}, '40-60': {active:0, inactive:0}, '60+': {active:0, inactive:0} };

    members.forEach(m => {
        if(m.dob) {
            const birthDate = new Date(m.dob);
            let age = today.getFullYear() - birthDate.getFullYear();
            const mdiff = today.getMonth() - birthDate.getMonth();
            if (mdiff < 0 || (mdiff === 0 && today.getDate() < birthDate.getDate())) age--;

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
    
    // Chart 1: Age Category
    const ctx1 = document.getElementById('ageCategoryChart').getContext('2d');
    if(ageCategoryChartInstance) ageCategoryChartInstance.destroy();
    ageCategoryChartInstance = new Chart(ctx1, {
        type: 'bar',
        data: {
            labels: Object.keys(ageGroups),
            datasets: [{ label: 'Members', data: Object.values(ageGroups), backgroundColor: accent, borderRadius: 4, barThickness: 20 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: {display:false} }, scales: { x: { grid: {display:false}, ticks: {color:'#888'} }, y: { display:false } } }
    });

    // Chart 2: Status by Age
    const ctx2 = document.getElementById('ageStatusChart').getContext('2d');
    if(ageStatusChartInstance) ageStatusChartInstance.destroy();
    ageStatusChartInstance = new Chart(ctx2, {
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

// --- IMAGE HANDLING ---
window.previewImage = (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => document.getElementById('preview-img').src = e.target.result;
        reader.readAsDataURL(input.files[0]);
    }
}

// --- MEMBER LOGIC ---
window.generateMemberID = (name, phone) => {
    const namePart = name.replace(/\s/g, '').substring(0, 4).toUpperCase();
    const phonePart = phone.slice(-4);
    return `GYM${namePart}${phonePart}`;
}

window.saveMember = async () => {
    const name = document.getElementById('inp-name').value;
    const phone = document.getElementById('inp-phone').value;
    const amount = document.getElementById('inp-amount').value;
    const dob = document.getElementById('inp-dob').value;
    const imgSrc = document.getElementById('preview-img').src;
    
    if(!name || !amount || !dob) return alert("Fill Name, Fees and DOB");

    const data = {
        name, phone, dob,
        joinDate: document.getElementById('inp-join').value,
        expiryDate: document.getElementById('inp-expiry').value,
        planDuration: document.getElementById('inp-plan').value,
        lastPaidAmount: amount,
        photo: imgSrc.includes('base64') ? imgSrc : null // Only save if changed
    };

    if(editingMemberId) {
        await updateDoc(doc(db, `gyms/${currentUser.uid}/members`, editingMemberId), data);
        editingMemberId = null;
    } else {
        data.createdAt = new Date();
        data.memberId = window.generateMemberID(name, phone);
        await addDoc(collection(db, `gyms/${currentUser.uid}/members`), data);
        if(confirm("Generate Invoice?")) generateInvoice(data);
    }
    toggleMemberModal();
};

window.toggleMemberModal = () => { 
    const el = document.getElementById('modal-member'); 
    if(el.style.display !== 'flex') {
        if(!editingMemberId) {
            document.getElementById('inp-name').value = ""; document.getElementById('inp-phone').value = "";
            document.getElementById('inp-amount').value = ""; document.getElementById('inp-dob').value = "";
            document.getElementById('inp-join').valueAsDate = new Date();
            document.getElementById('preview-img').src = "https://via.placeholder.com/100";
            window.calcExpiry();
        }
    } else { editingMemberId = null; }
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex'; 
};

window.calcExpiry = () => { 
    const j = document.getElementById('inp-join').value; 
    const m = parseInt(document.getElementById('inp-plan').value); 
    if(j) { const d = new Date(j); d.setMonth(d.getMonth() + m); document.getElementById('inp-expiry').value = d.toISOString().split('T')[0]; } 
};

window.editMember = (id) => {
    const m = members.find(x => x.id === id); if(!m) return;
    editingMemberId = id;
    document.getElementById('inp-name').value = m.name; document.getElementById('inp-phone').value = m.phone; 
    document.getElementById('inp-amount').value = m.lastPaidAmount; document.getElementById('inp-dob').value = m.dob;
    document.getElementById('inp-join').value = m.joinDate; document.getElementById('inp-expiry').value = m.expiryDate; 
    document.getElementById('inp-plan').value = m.planDuration||1;
    document.getElementById('preview-img').src = m.photo || "https://via.placeholder.com/100";
    document.getElementById('modal-member').style.display = 'flex';
};

window.deleteMember = async (id) => { if(confirm("Delete member?")) await deleteDoc(doc(db, `gyms/${currentUser.uid}/members`, id)); };

window.renewMember = (id) => {
    window.editMember(id); // Opens edit for now, typically sets new dates
    alert("Update the Join Date and Payment to Renew.");
};

// --- RENDER LIST (Detailed Row) ---
function renderMembersList() {
    const list = document.getElementById('members-list'); list.innerHTML = "";
    const today = new Date();

    members.forEach(m => {
        const expDate = new Date(m.expiryDate);
        const daysLeft = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
        let statusClass = 'status-paid'; let statusText = 'Paid';
        
        if (daysLeft < 0) { statusClass = 'status-due'; statusText = 'Expired'; }
        else if (daysLeft < 5) { statusClass = 'status-pending'; statusText = `Due in ${daysLeft} days`; }

        const photoUrl = m.photo || "https://via.placeholder.com/100";
        const whatsappLink = `https://wa.me/91${m.phone}?text=Hello ${m.name}, your membership expires on ${m.expiryDate}`;

        list.innerHTML += `
        <div class="member-row">
            <div class="profile-img-container">
                <img src="${photoUrl}" class="profile-circle" onclick="editMember('${m.id}')">
            </div>
            <div class="info-block">
                <div class="member-id-tag">${m.memberId || 'PENDING'}</div>
                <div class="info-main">${m.name}</div>
                <div class="info-sub">${m.phone}</div>
            </div>
            <div class="info-block">
                <div class="info-main">${m.joinDate}</div>
                <div class="info-sub">${m.planDuration} Month Plan</div>
            </div>
            <div><span class="status-badge ${statusClass}">${statusText}</span></div>
            <div class="row-actions">
                <div class="icon-btn" onclick="renewMember('${m.id}')" title="Renew"><i class="fa-solid fa-arrows-rotate"></i></div>
                <div class="icon-btn whatsapp" onclick="window.open('${whatsappLink}', '_blank')" title="Chat"><i class="fa-brands fa-whatsapp"></i></div>
                <div class="icon-btn bill" onclick='generateInvoice(${JSON.stringify(m)})' title="Bill"><i class="fa-solid fa-file-invoice"></i></div>
                <div class="icon-btn delete" onclick="deleteMember('${m.id}')" title="Delete"><i class="fa-solid fa-trash"></i></div>
            </div>
        </div>`;
    });
}

// --- INVOICE GENERATION (Professional) ---
window.generateInvoice = (m) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const primaryColor = [239, 68, 68]; // Red Accent

    // Header
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setFontSize(22); doc.setTextColor(255, 255, 255);
    doc.text("GYM PAYMENT RECEIPT", 105, 25, null, null, "center");

    // Details
    doc.setTextColor(0, 0, 0); doc.setFontSize(10);
    doc.text(`Receipt #: REC-${Math.floor(Math.random()*10000)}`, 14, 50);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 150, 50);

    doc.setFontSize(12); doc.setFont(undefined, 'bold');
    doc.text("Member Details:", 14, 60);
    doc.setFont(undefined, 'normal'); doc.setFontSize(10);
    doc.text(`Name: ${m.name}`, 14, 66);
    doc.text(`ID: ${m.memberId || 'N/A'}`, 14, 71);
    doc.text(`Phone: ${m.phone}`, 14, 76);
    doc.text(`Valid Until: ${m.expiryDate}`, 14, 81);

    // Table
    doc.autoTable({
        startY: 90,
        head: [['Description', 'Duration', 'Amount']],
        body: [[`Gym Membership - ${m.planDuration} Months`, `${m.planDuration} Month(s)`, `Rs. ${m.lastPaidAmount}`]],
        theme: 'grid',
        headStyles: { fillColor: primaryColor }
    });

    // Footer
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.text(`Total Paid: Rs. ${m.lastPaidAmount}`, 150, finalY);
    doc.setFontSize(8); doc.setTextColor(100);
    doc.text("Thank you for training with us!", 105, finalY + 20, null, null, "center");

    doc.save(`${m.name}_Invoice.pdf`);
};

// --- NAVIGATION & OTHER ---
window.switchTab = (tab) => {
    document.querySelectorAll('.view-section').forEach(e => e.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.getElementById(`view-${tab}`).style.display = 'block';
    document.getElementById(`tab-${tab}`).classList.add('active');
};
window.toggleTxModal = () => { document.getElementById('modal-transaction').style.display = document.getElementById('modal-transaction').style.display==='flex'?'none':'flex'; };
window.saveTransaction = async () => { /* Standard Tx Logic */
    const type = document.getElementById('tx-type').value; const cat = document.getElementById('tx-category').value; const amt = parseFloat(document.getElementById('tx-amount').value);
    const date = document.getElementById('tx-date').value;
    if(!cat || !amt) return alert("Fill details");
    await addDoc(collection(db, `gyms/${currentUser.uid}/transactions`), { type, category: cat, amount: amt, date, createdAt: new Date() });
    window.toggleTxModal();
};
window.filterMembers = () => { const q = document.getElementById('member-search').value.toLowerCase(); document.querySelectorAll('.member-row').forEach(c => c.style.display = c.innerText.toLowerCase().includes(q) ? 'grid' : 'none'); };
function renderFinanceList() { const l=document.getElementById('finance-list'); l.innerHTML=''; let p=0; transactions.forEach(t=>{ if(t.type=='income') p+=t.amount; else p-=t.amount; l.innerHTML+=`<div class="member-card" style="display:flex;justify-content:space-between"><span>${t.category}</span><span style="color:${t.type=='income'?'#22c55e':'#ef4444'}">${t.type=='income'?'+':'-'} ${t.amount}</span></div>`; }); document.getElementById('total-profit').innerText="₹"+p; }
