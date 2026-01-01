import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, where, onSnapshot, orderBy, doc, deleteDoc, updateDoc } from "./firebase-init.js";

// --- STATE MANAGEMENT ---
let currentUser = null;
let members = [];
let transactions = [];

// --- AUTHENTICATION ---
window.handleGoogleLogin = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login failed", error);
        alert("Login failed: " + error.message);
    }
};

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

// --- INITIALIZATION ---
function initApp() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById("today-date").innerText = new Date().toLocaleDateString('en-IN', options);
    setupRealtimeListeners();
}

// --- DATABASE LISTENERS ---
function setupRealtimeListeners() {
    // 1. Members Listener
    const membersRef = collection(db, `gyms/${currentUser.uid}/members`);
    const qMembers = query(membersRef, orderBy("joinDate", "desc"));

    onSnapshot(qMembers, (snapshot) => {
        members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderDashboard();
        renderMembersList();
    });

    // 2. Transactions Listener
    const txRef = collection(db, `gyms/${currentUser.uid}/transactions`);
    const qTx = query(txRef, orderBy("date", "desc"));

    onSnapshot(qTx, (snapshot) => {
        transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderFinanceList();
    });
}

// --- NAVIGATION ---
window.switchTab = (tabName) => {
    document.querySelectorAll(".view-section").forEach(el => el.style.display = "none");
    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
    
    document.getElementById(`view-${tabName}`).style.display = "block";
    
    const navIndex = ['dashboard', 'members', 'finance'].indexOf(tabName);
    if(navIndex >= 0) document.querySelectorAll(".nav-item")[navIndex].classList.add("active");
};

// --- VIEW: DASHBOARD ---
function renderDashboard() {
    const today = new Date().toISOString().split('T')[0];
    let activeCount = 0;
    let expiringCount = 0;
    let revenue = 0;

    const alertList = document.getElementById("alert-list");
    alertList.innerHTML = "";

    members.forEach(member => {
        const isExpired = member.expiryDate < today;
        
        if (!isExpired) {
            activeCount++;
            const daysLeft = (new Date(member.expiryDate) - new Date()) / (1000 * 60 * 60 * 24);
            if (daysLeft <= 5 && daysLeft >= 0) {
                expiringCount++;
                createAlertItem(member, Math.ceil(daysLeft));
            }
        } else {
            createAlertItem(member, -1); 
        }

        // Simple revenue calculation from Members fee (Optional: can use finance data instead)
        revenue += parseInt(member.lastPaidAmount || 0);
    });

    document.getElementById("stat-active").innerText = activeCount;
    document.getElementById("stat-expiring").innerText = expiringCount;
    document.getElementById("stat-revenue").innerText = "₹" + (revenue / 1000).toFixed(1) + "k";
}

function createAlertItem(member, daysLeft) {
    const list = document.getElementById("alert-list");
    const div = document.createElement("div");
    div.className = "member-card"; 
    div.style.marginBottom = "10px";
    div.style.padding = "15px";
    
    let statusText = daysLeft < 0 ? "EXPIRED" : `Expires in ${daysLeft} days`;
    let statusColor = daysLeft < 0 ? "#ef4444" : "#f59e0b";

    div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; gap:10px; align-items:center;">
                <div class="member-avatar">${member.name.charAt(0)}</div>
                <div>
                    <h4 style="margin:0;">${member.name}</h4>
                    <span style="font-size:0.8rem; color:${statusColor}; font-weight:bold;">${statusText}</span>
                </div>
            </div>
            <button class="btn-mini btn-whatsapp" onclick="sendWhatsApp('${member.phone}', '${member.name}', '${member.expiryDate}')">
                <i class="fa-brands fa-whatsapp"></i> Remind
            </button>
        </div>
    `;
    list.appendChild(div);
}

// --- VIEW: MEMBERS ---
function renderMembersList() {
    const list = document.getElementById("members-list");
    list.innerHTML = "";
    const today = new Date().toISOString().split('T')[0];

    members.forEach(member => {
        const isExpired = member.expiryDate < today;
        const statusClass = isExpired ? "status-expired" : "status-active";

        const card = document.createElement("div");
        card.className = "member-card";
        card.innerHTML = `
            <div class="member-status ${statusClass}"></div>
            <div class="member-header">
                <div class="member-avatar">${member.name.charAt(0)}</div>
                <div>
                    <h3 style="margin:0 0 5px 0;">${member.name}</h3>
                    <p style="margin:0; font-size:0.8rem; color:#888;">${member.phone}</p>
                </div>
            </div>
            <div style="font-size:0.85rem; color:#ccc; margin-bottom:15px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span>Joined:</span> <span>${member.joinDate}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>Expires:</span> <span style="color:${isExpired ? '#ef4444':'#22c55e'}">${member.expiryDate}</span>
                </div>
            </div>
            <div class="member-actions">
                <button class="btn-mini btn-whatsapp" onclick="sendWhatsApp('${member.phone}', '${member.name}', '${member.expiryDate}')">
                    <i class="fa-brands fa-whatsapp"></i> Chat
                </button>
                <button class="btn-mini btn-edit" onclick="generateInvoice('${member.name}', '${member.lastPaidAmount}', '${member.expiryDate}')">
                    <i class="fa-solid fa-file-invoice"></i> Bill
                </button>
            </div>
        `;
        list.appendChild(card);
    });
}

// --- VIEW: FINANCE ---
function renderFinanceList() {
    const list = document.getElementById("finance-list");
    list.innerHTML = "";

    let totalIncome = 0;
    let totalExpense = 0;

    if (transactions.length === 0) {
        list.innerHTML = '<div class="empty-state" style="text-align:center; padding:20px; color:#555;">No transactions yet</div>';
    } else {
        transactions.forEach(tx => {
            if(tx.type === 'income') totalIncome += tx.amount;
            else totalExpense += tx.amount;
    
            const isIncome = tx.type === 'income';
            const color = isIncome ? '#22c55e' : '#ef4444';
            const icon = isIncome ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
    
            const item = document.createElement("div");
            item.className = "member-card";
            item.style.marginBottom = "10px";
            item.style.display = "flex";
            item.style.justifyContent = "space-between";
            item.style.alignItems = "center";
            item.style.padding = "15px";
    
            item.innerHTML = `
                <div style="display:flex; align-items:center; gap:15px;">
                    <div style="width:40px; height:40px; border-radius:10px; background:${color}20; display:flex; align-items:center; justify-content:center; color:${color};">
                        <i class="fa-solid ${icon}"></i>
                    </div>
                    <div>
                        <h4 style="margin:0;">${tx.category}</h4>
                        <span style="font-size:0.8rem; color:#888;">${tx.date}</span>
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:bold; color:${color};">
                        ${isIncome ? '+' : '-'} ₹${tx.amount}
                    </div>
                    <i class="fa-solid fa-trash" style="color:#444; cursor:pointer; font-size:0.8rem; margin-top:5px;" onclick="deleteTx('${tx.id}')"></i>
                </div>
            `;
            list.appendChild(item);
        });
    }

    // Update Finance Summary Cards
    document.getElementById("fin-income").innerText = "₹" + totalIncome;
    document.getElementById("fin-expense").innerText = "₹" + totalExpense;
    const profit = totalIncome - totalExpense;
    const profitEl = document.getElementById("fin-profit");
    profitEl.innerText = "₹" + profit;
    profitEl.style.color = profit >= 0 ? "#22c55e" : "#ef4444";
}

// --- ACTIONS: MEMBERS ---

window.toggleMemberModal = () => {
    const modal = document.getElementById("modal-member");
    modal.style.display = modal.style.display === "flex" ? "none" : "flex";
    if(modal.style.display === "flex") {
        document.getElementById("inp-join").valueAsDate = new Date();
        calcExpiry(); 
    }
};

window.calcExpiry = () => {
    const joinDateVal = document.getElementById("inp-join").value;
    const months = parseInt(document.getElementById("inp-plan").value);
    
    if (joinDateVal) {
        const date = new Date(joinDateVal);
        date.setMonth(date.getMonth() + months);
        document.getElementById("inp-expiry").value = date.toISOString().split('T')[0];
    }
};

window.saveMember = async () => {
    const name = document.getElementById("inp-name").value;
    const phone = document.getElementById("inp-phone").value;
    const joinDate = document.getElementById("inp-join").value;
    const expiryDate = document.getElementById("inp-expiry").value;
    const amount = document.getElementById("inp-amount").value;
    const plan = document.getElementById("inp-plan").value; 

    if (!name || !phone || !amount) {
        alert("Please fill all fields!");
        return;
    }

    try {
        await addDoc(collection(db, `gyms/${currentUser.uid}/members`), {
            name, phone, joinDate, expiryDate, lastPaidAmount: amount, planDuration: plan, createdAt: new Date()
        });

        if(confirm("Member Saved! Download Receipt PDF?")) {
            generateInvoice(name, amount, expiryDate);
        }
        window.toggleMemberModal();
        document.getElementById("inp-name").value = "";
        document.getElementById("inp-phone").value = "";
        document.getElementById("inp-amount").value = "";

    } catch (e) {
        console.error(e);
        alert("Error saving member: " + e.message);
    }
};

// --- ACTIONS: FINANCE ---

window.toggleTxModal = () => {
    const modal = document.getElementById("modal-transaction");
    modal.style.display = modal.style.display === "flex" ? "none" : "flex";
    if(modal.style.display === "flex") {
        document.getElementById("tx-date").valueAsDate = new Date();
    }
};

window.saveTransaction = async () => {
    const type = document.getElementById("tx-type").value;
    const date = document.getElementById("tx-date").value;
    const category = document.getElementById("tx-category").value;
    const amount = parseFloat(document.getElementById("tx-amount").value);

    if (!category || !amount) {
        alert("Please fill in Category and Amount");
        return;
    }

    try {
        await addDoc(collection(db, `gyms/${currentUser.uid}/transactions`), {
            type, date, category, amount, createdAt: new Date()
        });
        window.toggleTxModal();
        
        document.getElementById("tx-category").value = "";
        document.getElementById("tx-amount").value = "";
    } catch (e) {
        console.error(e);
        alert("Error: " + e.message);
    }
};

window.deleteTx = async (id) => {
    if(confirm("Delete this entry?")) {
        await deleteDoc(doc(db, `gyms/${currentUser.uid}/transactions`, id));
    }
};

// --- HELPERS ---
window.sendWhatsApp = (phone, name, expiry) => {
    let cleanPhone = phone.replace(/\D/g,'');
    if(cleanPhone.length === 10) cleanPhone = "91" + cleanPhone; 
    const msg = `Hello ${name}, polite reminder from Gym 2.0. Your membership expires on ${expiry}. Please renew to continue your fitness journey! 💪`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.generateInvoice = (name, amount, expiry) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFillColor(239, 68, 68); 
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text("THE ULTIMATE GYM 2.0", 105, 20, null, null, "center");
    doc.setFontSize(12);
    doc.text("Payment Receipt", 105, 30, null, null, "center");

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    
    let y = 60;
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, y);
    y += 10;
    doc.text(`Member Name: ${name}`, 20, y);
    y += 10;
    doc.text(`Amount Paid: Rs. ${amount}/-`, 20, y);
    y += 10;
    doc.text(`Valid Until: ${expiry}`, 20, y);

    y += 20;
    doc.setLineWidth(0.5);
    doc.line(20, y, 190, y);
    
    y += 10;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("Thank you for training with us! No refunds.", 105, y, null, null, "center");

    doc.save(`${name}_Receipt.pdf`);
};

window.filterMembers = () => {
    const query = document.getElementById("member-search").value.toLowerCase();
    const cards = document.querySelectorAll("#members-list .member-card");
    
    cards.forEach(card => {
        const text = card.innerText.toLowerCase();
        card.style.display = text.includes(query) ? "block" : "none";
    });
};
