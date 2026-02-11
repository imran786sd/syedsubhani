import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, onSnapshot, orderBy, doc, deleteDoc, updateDoc, where, getDocs,setDoc } from "./firebase-init.js";

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
let selectedFitnessMember = null;
// Pagination State
let memberPage = 1;
let financePage = 1;
const itemsPerPage = 10; // Number of rows per page
window.isDemoMode = false; // <--- NEW: Demo Flag

// --- DEMO MODE LOGIC ---
window.startDemoMode = () => {
    window.isDemoMode = true;
    currentUser = { uid: "demo-user", displayName: "Demo Gym Owner" };
    
    document.getElementById("auth-wrapper").style.display = "none";
    document.getElementById("app-wrapper").style.display = "flex";
    
    // Inject Dummy Data
    members = [
        { id: '1', name: 'Rahul Sharma', phone: '9876543210', gender: 'Male', planDuration: '1y', joinDate: '2023-01-01', expiryDate: '2024-01-01', lastPaidAmount: 12000, memberId: 'GYMRAHU001', attendance: ['2023-10-25', '2023-10-26'], photo: null, fitnessStats: { currentWeight: 75, startHeight: 175 } },
        { id: '2', name: 'Priya Singh', phone: '9988776655', gender: 'Female', planDuration: '3m', joinDate: '2023-09-01', expiryDate: '2023-10-01', lastPaidAmount: 4500, memberId: 'GYMPRIY002', attendance: [], photo: null, fitnessStats: { currentWeight: 60, startHeight: 165 } }
    ];
    
    transactions = [
        { id: 't1', type: 'income', category: 'Membership Fees', amount: 12000, date: '2023-01-01', mode: 'UPI' },
        { id: 't2', type: 'expense', category: 'Rent', amount: 15000, date: '2023-10-01', mode: 'Cash' }
    ];

    initApp();
    
    // Manually render views since Firebase listeners are off
    renderDashboard();
    renderOverview(); 
    renderMembersList();
    renderAgeCharts();
    renderFitnessList();
    renderFinanceList();

    alert("🔹 Demo Mode Active\nChanges here will NOT be saved to the database.");
};

// --- HELPER FUNCTIONS ---
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

// --- CHART PLUGIN ---
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
                        const isLight = document.body.classList.contains('light-mode');
                        const textColor = isLight ? '#000' : '#fff';
                        ctx.fillStyle = textColor;
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
                            if(dataset.stack) ctx.fillStyle = isLight ? '#000' : '#fff';
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
    
    // Desktop Nav
    const dTab = document.getElementById(`tab-${tab}`);
    if(dTab) dTab.classList.add('active');

    // Mobile Nav
    document.querySelectorAll('.nav-btn').forEach(e => e.classList.remove('active'));
    const mTab = document.getElementById(`mob-${tab}`);
    if(mTab) mTab.classList.add('active');
};

window.toggleMobileMenu = () => { console.log("Mobile menu toggled"); };

// --- AUTH ---
window.handleGoogleLogin = async () => { try { await signInWithPopup(auth, provider); } catch (e) { alert("Login Failed: " + e.message); } };
window.handleLogout = () => signOut(auth);

onAuthStateChanged(auth, (user) => {
    // CRITICAL FIX: Ignore Firebase Auth updates if in Demo Mode
    if (window.isDemoMode) return; 

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
    const savedMode = localStorage.getItem('gymLightMode');
    if (savedMode === 'enabled') {
        document.body.classList.add('light-mode');
        const toggle = document.getElementById('mode-toggle');
        if(toggle) toggle.checked = true;
    }
    setTheme(currentTheme);
    updateClock();
    setInterval(updateClock, 1000);
    setupListeners();
}

function updateClock() {
    const el = document.getElementById("clock-display");
    if(el) el.innerText = new Date().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
}

window.toggleLightMode = () => {
    const body = document.body;
    const isLight = body.classList.toggle('light-mode');
    localStorage.setItem('gymLightMode', isLight ? 'enabled' : 'disabled');
    renderDashboard();
    renderAgeCharts();
};

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
    // START FIX: Disable listeners in Demo Mode
    if (window.isDemoMode) {
        console.log("Demo Mode: Firebase listeners disabled.");
        return; 
    }
    // END FIX

    const memRef = collection(db, `gyms/${currentUser.uid}/members`);
    onSnapshot(query(memRef, orderBy("joinDate", "desc")), (snap) => {
        members = snap.docs.map(d => ({id:d.id, ...d.data()}));
        renderDashboard();
        renderOverview(); 
        renderMembersList();
        renderAgeCharts();
        renderFitnessList();
    });
    const txRef = collection(db, `gyms/${currentUser.uid}/transactions`);
    onSnapshot(query(txRef, orderBy("date", "desc")), (snap) => {
        transactions = snap.docs.map(d => ({id:d.id, ...d.data()}));
        renderDashboard();
        renderOverview();
        renderFinanceList();
    });
}

// --- NEW FEATURES IMPLEMENTATION ---

// 1. WhatsApp Logic (Enhanced)
window.sendWhatsApp = (phone, name, type, extraData) => {
    let p = phone ? phone.replace(/\D/g,'') : ''; 
    if(p.length===10) p="91"+p;
    if(!p) return alert("Invalid phone number");

    let msg = "";
    
    if (type === 'welcome') {
        msg = `Hi ${name}, Welcome to The Ultimate Gym! We are thrilled to have you. Let's start your fitness journey! 💪`;
    } 
    else if (type === 'reminder') {
        // extraData is "Days Remaining" (e.g. 5)
        msg = `Hello ${name}, your gym membership is expiring in ${extraData} days. Please renew to continue your workouts! 🏋️‍♂️`;
    } 
    else if (type === 'expired') {
        // extraData is "Expiry Date" (e.g. 2023-12-01)
        msg = `Hi ${name}, your gym membership expired on ${extraData}. Please renew it to reactivate your access.`;
    } 
    else {
        msg = `Hello ${name}, regarding your gym membership.`;
    }

    window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank');
}

// 2. Attendance Logic (Updated: Toggle/Revoke)
window.markAttendance = async (id) => {
    if (window.isDemoMode) return alert("Feature disabled in Demo Mode."); // Demo Check

    const m = members.find(x => x.id === id);
    if(!m) return;
    
    const today = new Date().toISOString().split('T')[0];
    let currentAttendance = m.attendance || [];

    // TOGGLE LOGIC:
    if(currentAttendance.includes(today)) {
        // Revoke (Remove)
        currentAttendance = currentAttendance.filter(d => d !== today);
    } else {
        // Mark (Add)
        currentAttendance.push(today);
    }

    try {
        await updateDoc(doc(db, `gyms/${currentUser.uid}/members`, id), {
            attendance: currentAttendance
        });
        // Feedback is handled by UI update
    } catch(e) {
        console.error("Attendance failed", e);
        alert("Failed to update attendance");
    }
};

// --- FITNESS / BMI LOGIC (Updated for Workout Plans & No Height Update) ---

window.calculateQuickBMI = () => {
    const w = parseFloat(document.getElementById('calc-weight').value);
    const h = parseFloat(document.getElementById('calc-height').value);
    if(!w || !h) return alert("Please enter weight (kg) and height (cm)");
    
    const bmi = (w / ((h/100) * (h/100))).toFixed(1);
    const el = document.getElementById('quick-bmi-result');
    el.innerText = `Result: ${bmi}`;
    
    if(bmi < 18.5) el.style.color = "#facc15"; 
    else if(bmi < 25) el.style.color = "#22c55e"; 
    else el.style.color = "#ef4444"; 
}

function renderFitnessList() {
    const list = document.getElementById('fitness-list-grid');
    if(!list) return;
    list.innerHTML = "";

    members.forEach(m => {
        const placeholder = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzMzMyIvPjwvc3ZnPg==";
        const photoUrl = m.photo || placeholder;
        
        let bmiDisplay = "No Data";
        // Calculate BMI based on stored stats
        if(m.fitnessStats && m.fitnessStats.currentWeight && m.fitnessStats.startHeight) {
            const w = m.fitnessStats.currentWeight;
            const h = m.fitnessStats.startHeight / 100; // Use startHeight as constant height
            bmiDisplay = "BMI: " + (w / (h*h)).toFixed(1);
        }

        list.innerHTML += `
            <div class="stat-card" style="cursor:pointer;" onclick="openFitnessModal('${m.id}')">
                <img src="${photoUrl}" style="width:60px; height:60px; border-radius:50%; object-fit:cover; border:2px solid var(--border); margin-bottom:10px;">
                <div class="stat-number" style="font-size:1.1rem;">${m.name}</div>
                <div class="stat-label" style="margin-bottom:5px;">${m.memberId}</div>
                <div class="stat-label" style="color:var(--accent); font-weight:bold;">${bmiDisplay}</div>
            </div>
        `;
    });
}

window.openFitnessModal = (id) => {
    const m = members.find(x => x.id === id);
    if(!m) return;
    selectedFitnessMember = m;

    document.getElementById('fit-id').value = id;
    document.getElementById('fit-name').innerText = m.name;
    document.getElementById('fit-plan').innerText = window.formatPlanDisplay(m.planDuration);
    
    const placeholder = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzMzMyIvPjwvc3ZnPg==";
    document.getElementById('fit-img').src = m.photo || placeholder;

    const stats = m.fitnessStats || {};
    document.getElementById('fit-start-w').value = stats.startWeight || "";
    document.getElementById('fit-start-h').value = stats.startHeight || "";
    document.getElementById('fit-curr-w').value = stats.currentWeight || "";
    // Note: 'fit-curr-h' is no longer needed/updated, we rely on startHeight

    // LOAD WORKOUT PLAN
    const workoutInput = document.getElementById('fit-workout');
    if(workoutInput) {
        workoutInput.value = m.workoutPlan || ""; 
    }

    calculateFitnessDiff();
    document.getElementById('modal-fitness').style.display = 'flex';
};

window.closeFitnessModal = () => {
    document.getElementById('modal-fitness').style.display = 'none';
};

window.saveFitnessData = async () => {
    if(!selectedFitnessMember) return;
    if (window.isDemoMode) return alert("Saving disabled in Demo Mode.");
    
    // BIOLOGY CHECK: We only track weight changes. Height is static.
    const sw = parseFloat(document.getElementById('fit-start-w').value);
    const sh = parseFloat(document.getElementById('fit-start-h').value); // Acts as the constant height
    const cw = parseFloat(document.getElementById('fit-curr-w').value);

    // SAVE WORKOUT PLAN
    const workoutInput = document.getElementById('fit-workout');
    const workoutPlan = workoutInput ? workoutInput.value : "";

    const newStats = {
        startWeight: sw || null,
        startHeight: sh || null, // Height remains constant
        currentWeight: cw || null,
        currentHeight: sh || null, // Keep current height same as start height
        lastUpdated: new Date()
    };

    try {
        await updateDoc(doc(db, `gyms/${currentUser.uid}/members`, selectedFitnessMember.id), {
            fitnessStats: newStats,
            workoutPlan: workoutPlan
        });
        alert("Fitness profile & Workout plan updated!");
        window.closeFitnessModal();
    } catch(e) {
        console.error("Error saving fitness", e);
        alert("Save failed");
    }
};

window.calculateFitnessDiff = () => {
    const sw = parseFloat(document.getElementById('fit-start-w').value);
    const sh = parseFloat(document.getElementById('fit-start-h').value); // Constant Height
    const cw = parseFloat(document.getElementById('fit-curr-w').value);

    let startBMI = "--";
    if(sw && sh) startBMI = (sw / ((sh/100)**2)).toFixed(1);
    document.getElementById('fit-start-bmi').innerText = `BMI: ${startBMI}`;

    let currBMI = "--";
    // Use Start Height for Current BMI too (since adults don't grow taller)
    if(cw && sh) currBMI = (cw / ((sh/100)**2)).toFixed(1);
    document.getElementById('fit-curr-bmi').innerText = `BMI: ${currBMI}`;

    const resDiv = document.getElementById('fit-diff');
    if(sw && cw) {
        const diff = (cw - sw).toFixed(1);
        const sign = diff > 0 ? "+" : "";
        const color = diff > 0 ? "#ef4444" : "#22c55e"; 
        resDiv.innerHTML = `Weight Change: <span style="color:${color}">${sign}${diff} kg</span>`;
    } else {
        resDiv.innerHTML = "";
    }
};

window.filterFitnessGrid = () => {
    const q = document.getElementById('fitness-search').value.toLowerCase();
    const cards = document.getElementById('fitness-list-grid').children;
    for(let card of cards) {
        const text = card.innerText.toLowerCase();
        card.style.display = text.includes(q) ? 'flex' : 'none';
    }
};

// --- EXISTING HELPER FUNCTIONS ---
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
            DOB: m.dob || '',
            Plan: m.planDuration,
            JoinDate: m.joinDate,
            ExpiryDate: m.expiryDate,
            LastPaid: m.lastPaidAmount,
            Status: new Date(m.expiryDate) > new Date() ? 'Active' : 'Expired',
            Attendance: m.attendance ? m.attendance.length : 0
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

        const fixDate = (dStr) => {
            if(!dStr) return "";
            dStr = dStr.trim();
            if(dStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dStr;
            const parts = dStr.split(/[-/]/); 
            if(parts.length === 3) {
                return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
            }
            return dStr; 
        };

        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',');
            if(cols.length < 5) continue;

            const clean = (val) => val ? val.replace(/"/g, '').trim() : "";
            
            const name = clean(cols[0]);
            const phone = clean(cols[1]);
            const gender = clean(cols[2]) || 'Male';
            const dob = fixDate(clean(cols[3]));        
            const joinDate = fixDate(clean(cols[4]));   
            const plan = clean(cols[5]);                
            const amount = clean(cols[6]) || 0;        
            const payMode = clean(cols[7]) || 'Cash';   

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
                        name, phone, gender, 
                        dob: dob,            
                        joinDate: joinDate, 
                        planDuration: plan,
                        expiryDate: expiryDate,
                        lastPaidAmount: amount,
                        memberId: memberId,
                        createdAt: new Date(),
                        photo: null,
                        attendance: [] 
                    });

                    if(amount > 0) {
                        await addFinanceEntry(`Imported - ${name}`, amount, payMode, joinDate, docRef.id, plan, expiryDate);
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

// --- REPLACE YOUR EXISTING addFinanceEntry FUNCTION WITH THIS ---
async function addFinanceEntry(category, amount, mode, date, memberId, plan, expiry) {
    if (window.isDemoMode) return;

    // 1. Validate Data
    const safeAmount = parseFloat(amount);
    if (isNaN(safeAmount) || safeAmount <= 0) {
        console.warn("Skipping finance entry: Invalid amount", amount);
        return; 
    }

    console.log("Saving Transaction:", { category, safeAmount, mode, date });

    try {
        await addDoc(collection(db, `gyms/${currentUser.uid}/transactions`), {
            type: 'income',
            category: category,
            amount: safeAmount,
            date: date,
            mode: mode || 'Cash', // Default to Cash if undefined
            memberId: memberId || null,
            snapshotPlan: plan || null,
            snapshotExpiry: expiry || null,
            createdAt: new Date()
        });
        console.log("Transaction saved successfully.");
    } catch(e) {
        console.error("FINANCE SAVE FAILED:", e);
        // This alert will tell you EXACTLY why it's not saving
        alert("⚠️ Member Saved, but Finance Entry Failed!\n\nError: " + e.message);
    }
}

function renderDashboard() {
    if(!members.length && !transactions.length) return;
    const now = new Date().getTime();
    
    const txIncome = transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0);
    const txExpense = transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const memIncome = members.reduce((a, b) => a + parseInt(b.lastPaidAmount||0), 0);
    const totalRev = txIncome + memIncome;
    const formatNum = (n) => n >= 1000 ? (n/1000).toFixed(1)+'k' : n;
    
    if(document.getElementById("hero-clients")) {
        document.getElementById("hero-clients").innerText = members.length;
        document.getElementById("hero-revenue").innerText = "₹" + formatNum(totalRev);
        document.getElementById("hero-expense").innerText = "₹" + formatNum(txExpense);
    }

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

function renderOverview() {
    const gridContainer = document.getElementById("stats-grid-container");
    if(!gridContainer) return;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const formatNum = (n) => n >= 1000 ? (n/1000).toFixed(1)+'k' : n;

    const totalMembers = members.length;
    const activeMembers = members.filter(m => new Date(m.expiryDate) >= now).length;
    const inactiveMembers = totalMembers - activeMembers;

    const newMembers = members.filter(m => {
        const j = new Date(m.joinDate);
        return j.getMonth() === currentMonth && j.getFullYear() === currentYear;
    }).length;

    const pendingMembers = members.filter(m => {
        const d = new Date(m.expiryDate);
        const diffDays = (d - now) / (1000 * 60 * 60 * 24);
        return diffDays >= 0 && diffDays <= 7;
    }).length;

    const overdueMembers = members.filter(m => {
        const d = new Date(m.expiryDate);
        const diffDays = (now - d) / (1000 * 60 * 60 * 24);
        return diffDays > 0 && diffDays <= 30;
    }).length;

    const totalRev = transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0) + 
                     members.reduce((a, b) => a + parseInt(b.lastPaidAmount||0), 0);
    const totalExp = transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const netIncome = totalRev - totalExp;

    gridContainer.innerHTML = `
        <div class="stat-card"><div class="stat-icon-circle icon-blue"><i class="fa-solid fa-users"></i></div><div class="stat-number">${totalMembers}</div><div class="stat-label">Total Members</div></div>
        <div class="stat-card"><div class="stat-icon-circle icon-green"><i class="fa-solid fa-user-check"></i></div><div class="stat-number">${activeMembers}</div><div class="stat-label">Active Members</div></div>
        <div class="stat-card"><div class="stat-icon-circle icon-red"><i class="fa-solid fa-user-slash"></i></div><div class="stat-number">${inactiveMembers}</div><div class="stat-label">Inactive Members</div></div>
        <div class="stat-card"><div class="stat-icon-circle icon-purple"><i class="fa-solid fa-user-plus"></i></div><div class="stat-number">${newMembers}</div><div class="stat-label">New This Month</div></div>
        <div class="stat-card"><div class="stat-icon-circle icon-orange"><i class="fa-solid fa-hourglass-half"></i></div><div class="stat-number">${pendingMembers}</div><div class="stat-label">Pending / Follow-up</div></div>
        <div class="stat-card"><div class="stat-icon-circle icon-red"><i class="fa-solid fa-bell"></i></div><div class="stat-number">${overdueMembers}</div><div class="stat-label">Recently Overdue</div></div>
        <div class="stat-card"><div class="stat-icon-circle icon-green"><i class="fa-solid fa-indian-rupee-sign"></i></div><div class="stat-number">₹${formatNum(totalRev)}</div><div class="stat-label">Total Revenue</div></div>
        <div class="stat-card"><div class="stat-icon-circle icon-teal"><i class="fa-solid fa-scale-balanced"></i></div><div class="stat-number">₹${formatNum(netIncome)}</div><div class="stat-label">Net Income</div></div>
    `;
}

window.setMemberFilter = (filter) => {
    memberFilterState = filter;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    if(document.getElementById(`btn-filter-${filter}`)) {
        document.getElementById(`btn-filter-${filter}`).classList.add('active');
    }
    renderFilteredDashboardList();
}

function renderFilteredDashboardList() {
    const list = document.getElementById("dash-member-list");
    if(!list) return;
    list.innerHTML = "";
    
    const now = new Date().getTime();
    
    const sortedMembers = [...members].sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    const filtered = sortedMembers.filter(m => {
        const isExpired = now > new Date(m.expiryDate).getTime();
        return memberFilterState === 'active' ? !isExpired : isExpired;
    });

    if(filtered.length === 0) {
        list.innerHTML = '<div style="padding:10px; color:#888; text-align:center;">No members found.</div>';
        return;
    }

    filtered.slice(0, 10).forEach(m => {
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
    
    const isLight = document.body.classList.contains('light-mode');
    const expColor = isLight ? '#333' : '#fff';

    if(financeChartInstance) financeChartInstance.destroy();
    
    financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { 
            labels: ['Rev', 'Exp'], 
            datasets: [{ 
                data: [rev, exp], 
                backgroundColor: [accent, expColor], 
                borderRadius: 6, 
                barThickness: 30 
            }] 
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false } }, 
            scales: { x: { display: false }, y: { display: false } }, 
            layout: { padding: { top: 20 } } 
        }
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

function renderAgeCharts() {
    if(members.length === 0) return;
    const today = new Date();
    
    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? '#000' : '#fff';

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
                plugins: { legend: {display:true, labels:{color: textColor, boxWidth:10}} }, 
                scales: { 
                    x: { display: false, grid: {display:false} }, 
                    y: { grid: {display:false}, ticks: {color: textColor} } 
                } 
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
                plugins: { legend: {display:true, labels:{color: textColor, boxWidth:10}} }, 
                scales: { 
                    x: { display: false, grid: {display:false} }, 
                    y: { grid: {display:false}, ticks: {color: textColor} }
                } 
            },
            plugins: [dataLabelPlugin]
        });
    }
}

window.saveMember = async () => {
    // --- DEMO MODE CHECK ---
    if (window.isDemoMode) return alert("Saving is disabled in Demo Mode.");

    const name = document.getElementById('inp-name').value.trim();
    const gender = document.getElementById('inp-gender').value;
    const phone = document.getElementById('inp-phone').value.trim();
    const amount = document.getElementById('inp-amount').value;
    const dob = document.getElementById('inp-dob').value;
    const joinDate = document.getElementById('inp-join').value;
    const payMode = document.getElementById('inp-paymode').value;
    const planDuration = document.getElementById('inp-plan').value;
    const expiryDate = document.getElementById('inp-expiry').value;
    
    const fileInput = document.getElementById('inp-file');
    const file = fileInput.files ? fileInput.files[0] : null;
    
    if(!name || !amount || !dob || !joinDate || !phone) return alert("Please fill Name, Phone, Fees, Join Date and DOB");

    // 1. DUPLICATE CHECKS
    let finalMemberId = window.generateMemberID(name, phone);

    if (!editingMemberId) {
        const qId = query(collection(db, `gyms/${currentUser.uid}/members`), where("memberId", "==", finalMemberId));
        const snapId = await getDocs(qId);
        
        if (!snapId.empty) {
            let isExactDuplicate = false;
            snapId.forEach(doc => {
                const m = doc.data();
                if (m.phone === phone && m.dob === dob) isExactDuplicate = true;
            });

            if (isExactDuplicate) {
                return alert(`STOP: This member already exists!\n(Same Name, Phone, and DOB found)`);
            } else {
                // ID Collision - fix automatically
                finalMemberId = finalMemberId + "-" + Math.floor(Math.random() * 100);
            }
        }
        
        const qPhone = query(collection(db, `gyms/${currentUser.uid}/members`), where("phone", "==", phone));
        const snapPhone = await getDocs(qPhone);
        if (!snapPhone.empty) {
             const existing = snapPhone.docs[0].data();
             if (existing.dob === dob) {
                 return alert(`STOP: Phone number ${phone} is already registered to ${existing.name}!`);
             }
        }
    }

    // 2. IMAGE PROCESSING
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
    }

    // 3. PREPARE DATA
    const data = {
        name, gender, phone, dob, joinDate,
        expiryDate: expiryDate,
        planDuration: planDuration,
        lastPaidAmount: amount,
        photo: photoUrl 
    };

    // 4. SAVE TO DATABASE
    try {
        if(editingMemberId) {
            await updateDoc(doc(db, `gyms/${currentUser.uid}/members`, editingMemberId), data);
            editingMemberId = null;
            alert("Member updated successfully!");
        } else {
            data.createdAt = new Date();
            data.memberId = finalMemberId;
            data.attendance = []; 
            
            const docRef = await addDoc(collection(db, `gyms/${currentUser.uid}/members`), data);
            
            // --- CRITICAL FIX: Ensure Transaction is saved ---
            // We await this explicitly to ensure the payment mode is recorded
            await addFinanceEntry(`New Membership - ${data.name}`, amount, payMode, joinDate, docRef.id, planDuration, expiryDate);
            
            // --- FIX: CLOSE MODAL NOW (Don't wait for invoice) ---
            window.toggleMemberModal();
            fileInput.value = ""; 

            // 5. INVOICE GENERATION (Safety Block)
            // If this crashes offline, it won't break the app because modal is already closed
            if (window.jspdf) {
                if(confirm("Member Added! Generate Invoice?")) {
                    try {
                        window.generateInvoice(data);
                    } catch(err) {
                        console.error(err);
                        alert("Could not generate PDF. You might be offline and the PDF library isn't cached.");
                    }
                }
            } else {
                alert("Member added! (Invoice skipped - Offline mode)");
            }
            return; // Exit function
        }
        
        // Close modal for Edit case
        window.toggleMemberModal();
        fileInput.value = ""; 

    } catch (e) {
        console.error(e);
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
    if (window.isDemoMode) return alert("Disabled in Demo Mode.");

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

// --- UPDATED HISTORY LOGIC (DATES + PAYMENTS) ---
window.toggleHistory = async (id) => {
    const panel = document.getElementById(`history-${id}`);
    if(panel.style.display === 'block') { panel.style.display = 'none'; return; }

    panel.style.display = 'block';
    
    // 1. GET ATTENDANCE DATA
    const m = members.find(x => x.id === id);
    const attendanceList = m.attendance || [];
    // Sort dates (newest first)
    attendanceList.sort((a, b) => new Date(b) - new Date(a));

    let attendanceHTML = "";
    if(attendanceList.length > 0) {
        attendanceHTML = `
            <div style="margin-bottom:15px; border-bottom:1px solid #333; padding-bottom:10px;">
                <h4 style="color:#fff; margin:0 0 5px 0; font-size:0.9rem;">Attendance Log (${attendanceList.length} Days)</h4>
                <div style="max-height:100px; overflow-y:auto; display:flex; flex-wrap:wrap; gap:5px;">
                    ${attendanceList.map(date => `<span style="background:#333; color:#ccc; padding:2px 6px; border-radius:4px; font-size:0.75rem;">${date}</span>`).join('')}
                </div>
            </div>`;
    } else {
        attendanceHTML = `<div style="margin-bottom:15px; color:#666; font-size:0.8rem;">No attendance records found.</div>`;
    }

    if (window.isDemoMode) {
        panel.innerHTML = attendanceHTML + '<div style="color:#888; font-size:0.8rem;">Transactions hidden in demo.</div>';
        return;
    }

    panel.innerHTML = attendanceHTML + '<div style="color:#888; font-size:0.8rem;">Loading Payments...</div>';

    // 2. GET PAYMENT DATA
    const q = query(
        collection(db, `gyms/${currentUser.uid}/transactions`),
        where("memberId", "==", id),
        orderBy("date", "desc")
    );

    try {
        const snap = await getDocs(q);
        
        let paymentHTML = "";
        if(snap.empty) {
            paymentHTML = '<div style="color:#888; font-size:0.8rem;">No payment history found.</div>';
        } else {
            paymentHTML = `
                <h4 style="color:#fff; margin:0 0 5px 0; font-size:0.9rem;">Payment History</h4>
                <table class="history-table">
                    <thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Action</th></tr></thead>
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

                paymentHTML += `
                    <tr>
                        <td>${t.date}</td>
                        <td>${t.category}</td>
                        <td style="color:${t.type==='income'?'#22c55e':'#ef4444'}">${t.amount}</td>
                        <td><i class="fa-solid fa-print" style="cursor:pointer; color:#888;" onclick="printHistoryInvoice('${id}', '${t.amount}', '${t.date}', '${t.mode}', '${t.category}', '${safePlan}', '${safeExpiry}', '${timeStr}')"></i></td>
                    </tr>`;
            });
            paymentHTML += `</tbody></table>`;
        }
        
        panel.innerHTML = attendanceHTML + paymentHTML;

    } catch (e) {
        console.error(e);
        panel.innerHTML = attendanceHTML + '<div style="color:#ef4444; font-size:0.8rem;">Error loading payments.</div>';
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

window.generateInvoice = async (m, specificTransaction = null) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
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

    doc.setFillColor(...themeColor);
    doc.rect(0, 0, 210, 25, 'F');
    
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text("THE ULTIMATE GYM 2.0", 14, 16);

    try {
        const logoImg = new Image();
        logoImg.src = 'logo.png';
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
    doc.text(`Date: ${date}  ${time}`, 140, 45); 

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const address = "1-2-607/75/76, LIC Colony, Road, behind NTR Stadium, Ambedkar Nagar, Gandhi Nagar, Hyderabad, Telangana 500080";
    const splitAddress = doc.splitTextToSize(address, 180);
    doc.text(splitAddress, 14, 52);
    
    let currentY = 52 + (splitAddress.length * 4); 
    
    doc.text("Contact: +91 99485 92213 | +91 97052 73253", 14, currentY);
    currentY += 5; 
    doc.text("GST NO: 36CYZPA903181Z1", 14, currentY);

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

    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text("Payment Details", 14, finalY);
    
    doc.autoTable({
        startY: finalY + 5,
        head: [['Description', 'Date & Time', 'Mode', 'Amount']],
        body: [[category, `${date} ${time}`, mode, `Rs. ${amt}`]],
        theme: 'striped',
        headStyles: { fillColor: themeColor },
        styles: { fontSize: 9, cellPadding: 3 }
    });

    finalY = doc.lastAutoTable.finalY + 20;

    doc.setFontSize(10);
    doc.text("Receiver Sign:", 14, finalY);
    doc.text("Authorized Signature", 150, finalY);
    
    try {
        const signImg = new Image();
        signImg.src = 'Sign.jpeg'; 
        doc.addImage(signImg, 'JPEG', 150, finalY - 5, 50, 25); 
    } catch(e) { console.log("Sign error", e); }

    doc.line(14, finalY + 15, 60, finalY + 15);
    doc.line(150, finalY + 15, 196, finalY + 15);
   
    finalY += 30; 
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("Note: Fees once paid are not refundable.", 14, finalY);
    doc.text("Computer Generated Receipt.", 14, finalY + 5);

    doc.save(`${m.name}_Receipt.pdf`);
};

window.editMember = (id) => {
    const m = members.find(x => x.id === id); if(!m) return;
    editingMemberId = id;
    document.getElementById('inp-name').value = m.name; 
    document.getElementById('inp-gender').value = m.gender || 'Male'; 
    document.getElementById('inp-phone').value = m.phone; 
    document.getElementById('inp-amount').value = m.lastPaidAmount; 
    document.getElementById('inp-dob').value = m.dob;
    document.getElementById('inp-join').value = m.joinDate; 
    document.getElementById('inp-expiry').value = m.expiryDate; 
    document.getElementById('inp-plan').value = m.planDuration || "1m";
    const preview = document.getElementById('preview-img');
    if(m.photo) {
        preview.src = m.photo;
    } else {
        preview.src = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzMzMyIvPjwvc3ZnPg==";
    }
    document.getElementById('modal-member').style.display = 'flex';
};

window.deleteMember = async (id) => { 
    if(window.isDemoMode) return alert("Deleting is disabled in Demo Mode.");
    if(confirm("Delete member?")) await deleteDoc(doc(db, `gyms/${currentUser.uid}/members`, id)); 
};

window.saveTransaction = async () => {
    if(window.isDemoMode) return alert("Saving is disabled in Demo Mode.");
    const type = document.getElementById('tx-type').value; 
    const cat = document.getElementById('tx-category').value; 
    const mode = document.getElementById('tx-paymode').value;
    const amt = parseFloat(document.getElementById('tx-amount').value); 
    const date = document.getElementById('tx-date').value; 
    if(!cat || !amt) return alert("Fill details"); 
    const data = { type, category: cat, amount: amt, date, mode }; 
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

window.deleteTransaction = async (id) => { 
    if(window.isDemoMode) return alert("Deleting is disabled in Demo Mode.");
    if(confirm("Delete transaction?")) await deleteDoc(doc(db, `gyms/${currentUser.uid}/transactions`, id)); 
};

// --- RENDER MEMBERS (With Blue Badge & Revoke Logic) ---
window.renderMembersList = () => {
    const list = document.getElementById('members-list'); 
    if(!list) return; 
    list.innerHTML = "";

    const searchQ = document.getElementById('member-search') ? document.getElementById('member-search').value.toLowerCase() : "";
    const today = new Date().toISOString().split('T')[0];

    // 1. Filter first
    let filteredMembers = members.filter(m => 
        m.name.toLowerCase().includes(searchQ) || 
        (m.memberId && m.memberId.toLowerCase().includes(searchQ)) || 
        m.phone.includes(searchQ)
    );

    // 2. Pagination Logic
    const totalPages = Math.ceil(filteredMembers.length / itemsPerPage) || 1;
    
    // Ensure current page is valid
    if (memberPage > totalPages) memberPage = totalPages;
    if (memberPage < 1) memberPage = 1;

    // Update Indicator Text
    const indicator = document.getElementById('page-indicator-members');
    if(indicator) indicator.innerText = `Page ${memberPage} of ${totalPages}`;

    // Slice Data for current page
    const start = (memberPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const paginatedData = filteredMembers.slice(start, end);

    if (paginatedData.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding:20px; color:#666;">No members found.</div>`;
        return;
    }

    // 3. Render
    paginatedData.forEach(m => {
        const expDate = new Date(m.expiryDate);
        const daysLeft = Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24));
        let statusClass = daysLeft < 0 ? 'status-due' : (daysLeft < 5 ? 'status-pending' : 'status-paid');
        let statusText = daysLeft < 0 ? 'Expired' : (daysLeft < 5 ? `Due: ${daysLeft}` : 'Paid');
        let waType = daysLeft < 0 ? 'expired' : 'reminder';
        let waData = daysLeft < 0 ? m.expiryDate : daysLeft;
        
        list.innerHTML += `
        <div class="member-row">
            <i class="fa-solid fa-ellipsis-vertical mobile-kebab-btn" onclick="toggleRowAction('${m.id}')"></i>
            <div class="profile-img-container"><img src="${m.photo || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzMzMyIvPjwvc3ZnPg=='}" class="profile-circle" onclick="editMember('${m.id}')"></div>
            <div class="info-block"><div class="member-id-tag">${m.memberId}</div><div class="name-phone-row"><span class="info-main">${m.name}</span></div></div>
            <div class="info-block"><div class="info-main" style="color:${daysLeft<0?'#ef4444':'inherit'}">Exp: ${m.expiryDate}</div></div>
            <div style="display:flex;flex-direction:column;gap:5px;"><span class="status-badge ${statusClass}">${statusText}</span><span style="font-size:0.75rem;color:#fff;background:#3b82f6;padding:2px 6px;border-radius:4px;text-align:center;">${(m.attendance||[]).length} Days</span></div>
            <div class="row-actions" id="actions-${m.id}">
                <div class="icon-btn" onclick="markAttendance('${m.id}')"><i class="fa-solid fa-clipboard-check"></i></div>
                <div class="icon-btn" onclick="renewMember('${m.id}')"><i class="fa-solid fa-arrows-rotate"></i></div>
                <div class="icon-btn" onclick="editMember('${m.id}')"><i class="fa-solid fa-pen"></i></div>
                <div class="icon-btn" onclick="sendWhatsApp('${m.phone}', '${m.name}', '${waType}', '${waData}')"><i class="fa-brands fa-whatsapp"></i></div>
                <div class="icon-btn" onclick='generateInvoice(${JSON.stringify(m)})'><i class="fa-solid fa-file-invoice"></i></div>
                <div class="icon-btn" onclick='generateIDCard(${JSON.stringify(m)})' title="Download ID Card" style="color:#facc15;">
                    <i class="fa-solid fa-id-card"></i>
                </div>
                <div class="icon-btn" onclick="deleteMember('${m.id}')"><i class="fa-solid fa-trash"></i></div>
            </div>
        </div>`;
    });
};

window.renderFinanceList = () => { 
    const list = document.getElementById('finance-list'); 
    
    // Safety Check
    if (!list) {
        console.warn("Cannot find 'finance-list' HTML element. Skipping render.");
        return; 
    }
    
    list.innerHTML = ""; 

    // 1. Sort by Date Descending (Latest First)
    // We use a safe copy [...transactions]
    const sortedData = [...transactions].sort((a, b) => {
        const dateA = new Date(a.date || 0);
        const dateB = new Date(b.date || 0);
        return dateB - dateA; 
    });

    // 2. Pagination Logic
    const totalPages = Math.ceil(sortedData.length / itemsPerPage) || 1;
    if (financePage > totalPages) financePage = totalPages;
    if (financePage < 1) financePage = 1;

    // Update Indicator
    const indicator = document.getElementById('page-indicator-finance');
    if (indicator) indicator.innerText = `Page ${financePage} of ${totalPages}`;

    // Slice Data
    const start = (financePage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const paginatedData = sortedData.slice(start, end);

    // Calculate Total Profit (On ALL data)
    let totalProfit = 0;
    sortedData.forEach(t => { if(t.type === 'income') totalProfit += t.amount; else totalProfit -= t.amount; });

    // 3. Render
    if (paginatedData.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding:30px; color:#666;">No transactions found.</div>`;
    } else {
        paginatedData.forEach(t => { 
            const modeBadge = t.mode ? `<span style="font-size:0.7rem; background:#333; padding:2px 6px; border-radius:4px; margin-left:5px;">${t.mode}</span>` : '';
            
            list.innerHTML += `
            <div class="member-card" style="display:flex; justify-content:space-between; align-items:center; border-left: 4px solid ${t.type === 'income' ? '#22c55e' : '#ef4444'}; margin-bottom:10px; padding:15px; background:var(--bg-card); border-radius:8px; border:1px solid var(--border);">
                <div>
                    <span style="font-weight:600; display:block; font-size:1rem;">${t.category}</span>
                    <small style="color:#888; display:flex; align-items:center; margin-top:4px;">
                        <i class="fa-regular fa-calendar" style="margin-right:5px;"></i> ${t.date} ${modeBadge}
                    </small>
                </div>
                <div style="display:flex; gap:15px; align-items:center;">
                    <span style="color:${t.type==='income'?'#22c55e':'#ef4444'}; font-weight:bold; font-size:1.1rem;">
                        ${t.type==='income'?'+':'-'} ₹${t.amount}
                    </span>
                    <div style="display:flex; gap:10px;">
                        <i class="fa-solid fa-pen" style="cursor:pointer; color:#888" onclick="editTransaction('${t.id}')"></i>
                        <i class="fa-solid fa-trash" style="cursor:pointer; color:#ef4444" onclick="deleteTransaction('${t.id}')"></i>
                    </div>
                </div>
            </div>`; 
        });
    }

    const profitEl = document.getElementById('total-profit');
    if(profitEl) profitEl.innerText = "₹" + totalProfit.toLocaleString(); 
};
window.filterMembers = () => { 
    memberPage = 1; // Reset to first page on search
    renderMembersList(); 
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
window.changePage = (type, direction) => {
    if (type === 'members') {
        memberPage += direction;
        // Safety check: prevent going below page 1
        if (memberPage < 1) memberPage = 1; 
        renderMembersList();
    } else if (type === 'finance') {
        financePage += direction;
        if (financePage < 1) financePage = 1;
        renderFinanceList();
    }
};
// --- ID CARD GENERATOR ---
window.generateIDCard = (m) => {
    if (!window.jspdf) return alert("PDF Library not loaded.");
    const { jsPDF } = window.jspdf;
    
    // 1. Create PDF with Credit Card Dimensions (Landscape)
    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: [85.6, 53.98] // Standard ID-1 Card Size
    });

    // --- DESIGN SETTINGS ---
    const primaryColor = [20, 20, 20];   // Dark Background
    const accentColor = [239, 68, 68];   // Red Accent (Match your theme)
    const textColor = [255, 255, 255];   // White Text

    // 2. Draw Background
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 85.6, 53.98, 'F');

    // 3. Draw Header Strip
    doc.setFillColor(...accentColor);
    doc.rect(0, 0, 85.6, 10, 'F');

    // 4. Add Gym Name (Header)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...textColor);
    doc.text(gymSettings.name.toUpperCase(), 42.8, 7, { align: "center" });

    // 5. Member Photo (Left Side)
    // We check if they have a photo, otherwise put a gray box
    if (m.photo && m.photo.length > 100) {
        try {
            doc.addImage(m.photo, 'JPEG', 5, 15, 25, 25); // x, y, w, h
        } catch (e) {
            // Fallback if image is broken
            doc.setFillColor(50, 50, 50);
            doc.rect(5, 15, 25, 25, 'F');
            doc.setFontSize(6);
            doc.text("No Photo", 17.5, 27, { align: "center" });
        }
    } else {
        doc.setFillColor(50, 50, 50);
        doc.rect(5, 15, 25, 25, 'F');
    }

    // 6. Member Details (Right Side)
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");

    // Name
    doc.text("Name:", 35, 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(m.name.toUpperCase(), 35, 22);

    // ID
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Member ID:", 35, 28);
    doc.setFont("helvetica", "bold");
    doc.text(m.memberId, 35, 32);

    // Expiry
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Valid Until:", 35, 38);
    doc.setTextColor(...accentColor); // Make date red
    doc.setFont("helvetica", "bold");
    doc.text(m.expiryDate, 35, 42);

    // 7. Footer / Decorative Elements
    doc.setDrawColor(...accentColor);
    doc.setLineWidth(0.5);
    doc.line(5, 45, 80, 45); // Bottom line

    doc.setFontSize(6);
    doc.setTextColor(150, 150, 150);
    doc.text("Authorized Signature", 75, 50, { align: "right" });
    doc.text("+91 99485 92213", 5, 50, { align: "left" });

    // 8. Save
    doc.save(`${m.name}_ID_Card.pdf`);
};
// ======================================================
// 9. SETTINGS & CONFIGURATION
// ======================================================

// Default Settings
let gymSettings = {
    name: "THE ULTIMATE GYM 2.0",
    phone: "+91 99485 92213",
    address: "1-2-607/75/76, LIC Colony, Road, Hyderabad",
    taxId: "36CYZPA903181Z1",
    signature: "Sign.jpeg" // Default image path
};

// 1. Load Settings on Init
async function loadGymSettings() {
    if(window.isDemoMode) return; // Use defaults in demo
    
    try {
        const docRef = doc(db, `gyms/${currentUser.uid}/settings`, 'config');
        const docSnap = await getDocs(query(collection(db, `gyms/${currentUser.uid}/settings`))); // Simplification for single doc
        // Better:
        // Since we don't have a specific ID, we usually store it in a fixed ID 'config'
        // Let's assume we save to 'config'
        // For now, let's just stick to localStorage for speed + Demo
        const localConfig = localStorage.getItem('gymConfig');
        if(localConfig) {
            gymSettings = JSON.parse(localConfig);
            updateSettingsUI();
        }
    } catch(e) { console.log("Config load error", e); }
}

// 2. Update UI inputs with current settings
function updateSettingsUI() {
    document.getElementById('set-gym-name').value = gymSettings.name;
    document.getElementById('set-gym-phone').value = gymSettings.phone;
    document.getElementById('set-gym-address').value = gymSettings.address;
    document.getElementById('set-gym-tax').value = gymSettings.taxId;
    if(gymSettings.signature.length > 50) {
        document.getElementById('set-sign-preview').src = gymSettings.signature;
    }
}

// 3. Save Settings
window.saveGymSettings = async () => {
    const name = document.getElementById('set-gym-name').value;
    const phone = document.getElementById('set-gym-phone').value;
    const addr = document.getElementById('set-gym-address').value;
    const tax = document.getElementById('set-gym-tax').value;
    const img = document.getElementById('set-sign-preview').src;

    if(!name) return alert("Gym Name is required");

    gymSettings = { name, phone, address: addr, taxId: tax, signature: img };
    
    // Save to LocalStorage (Persist across reload)
    localStorage.setItem('gymConfig', JSON.stringify(gymSettings));
    
    // Optional: Save to Firebase here if you want cloud sync
    alert("Settings Saved! Future PDFs will use these details.");
};

window.previewSignature = (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => document.getElementById('set-sign-preview').src = e.target.result;
        reader.readAsDataURL(input.files[0]);
    }
};

// --- AUTO-LOAD ON STARTUP ---
// Add this line inside your existing initApp() function:
// loadGymSettings();
// ======================================================
// 10. FULL SYSTEM BACKUP & RESTORE
// ======================================================

// 1. BACKUP FUNCTION
window.backupDatabase = () => {
    if(members.length === 0 && transactions.length === 0) return alert("Database is empty!");

    // Create a single object with ALL data
    const fullBackup = {
        version: "2.0",
        timestamp: new Date().toISOString(),
        gymSettings: localStorage.getItem('gymConfig') ? JSON.parse(localStorage.getItem('gymConfig')) : {},
        members: members,
        transactions: transactions
    };

    // Convert to JSON string
    const dataStr = JSON.stringify(fullBackup, null, 2); // Pretty print

    // Download Logic
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    // Name the file with date (e.g., GymBackup_2023-10-27.json)
    a.download = `GymBackup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    alert("Backup Downloaded! Keep this file safe.");
};

// 2. RESTORE FUNCTION
window.restoreDatabase = () => {
    const input = document.getElementById('restore-file');
    const status = document.getElementById('restore-status');
    
    if (!input.files || !input.files[0]) return alert("Please select a .json backup file.");
    
    if(!confirm("⚠️ DANGER: This will DELETE all current data and replace it with the backup. Are you sure?")) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            status.innerText = "Reading file...";
            const backup = JSON.parse(e.target.result);

            // Validation: Check if it's a valid backup file
            if(!backup.members || !backup.transactions) throw new Error("Invalid Backup File");

            status.innerText = "Wiping current database...";
            
            // 1. WIPE CURRENT DATA (Use Batch or Loop)
            // Note: In a real app, you might use a batch delete. 
            // For this MVP, we will upload the backup data as NEW entries or Overwrite.
            // Since Firestore IDs are unique, we can just write them back.
            
            // A. Restore Settings
            if(backup.gymSettings) {
                localStorage.setItem('gymConfig', JSON.stringify(backup.gymSettings));
            }

            // B. Restore Members
            status.innerText = `Restoring ${backup.members.length} members...`;
            let mCount = 0;
            for (const m of backup.members) {
                // We use setDoc to keep the original ID intact
                await updateDoc(doc(db, `gyms/${currentUser.uid}/members`, m.id), m).catch(async () => {
                    // If document doesn't exist (because we wiped it or new db), create it
                    await setDoc(doc(db, `gyms/${currentUser.uid}/members`, m.id), m);
                });
                mCount++;
            }

            // C. Restore Transactions
            status.innerText = `Restoring ${backup.transactions.length} transactions...`;
            let tCount = 0;
            for (const t of backup.transactions) {
                await updateDoc(doc(db, `gyms/${currentUser.uid}/transactions`, t.id), t).catch(async () => {
                    await setDoc(doc(db, `gyms/${currentUser.uid}/transactions`, t.id), t);
                });
                tCount++;
            }

            status.innerHTML = `<span style="color:#22c55e">Success! Restored ${mCount} members & ${tCount} transactions. Reloading...</span>`;
            
            setTimeout(() => window.location.reload(), 2000);

        } catch(err) {
            console.error(err);
            status.innerHTML = `<span style="color:#ef4444">Error: ${err.message}</span>`;
        }
    };
    reader.readAsText(input.files[0]);
};
