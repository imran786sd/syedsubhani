// --- 2. FIREBASE LOGIC ---
    let auth, db, currentUserUID;
    
    // Listen for custom event from the module script to know modules are ready
    window.addEventListener('firebase-modules-loaded', () => {
        initFirebase();
    });

    async function initFirebase() {
        try {
            // Use the global window.firebaseModules object populated by the module script
            const app = window.firebaseModules.initializeApp(firebaseConfig);
            auth = window.firebaseModules.getAuth(app);
            db = window.firebaseModules.getFirestore(app);
            
            // Listen for login state
            window.firebaseModules.onAuthStateChanged(auth, (user) => {
                if (user) {
                    currentUserUID = user.uid;
                    updateProfileUI(user.displayName, user.photoURL);
                    showApp();
                    loadData(); // Load from Cloud
                } else {
                    currentUserUID = null;
                    document.getElementById('auth-wrapper').style.display = 'flex';
                    document.getElementById('app-wrapper').style.display = 'none';
                }
            });
        } catch(e) {
            console.error("Firebase Error:", e);
            alert("Firebase Error: " + e.message);
        }
    }

    // Google Login Function
    window.handleGoogleLogin = async function() {
        const provider = new window.firebaseModules.GoogleAuthProvider();
        try {
            await window.firebaseModules.signInWithPopup(auth, provider);
        } catch (error) {
            alert("Login Failed: " + error.message);
        }
    }

    window.handleLogout = function() {
        if(confirm("Logout from Google Account?")) {
            window.firebaseModules.signOut(auth);
            location.reload();
        }
    }

    function updateProfileUI(name, photo) {
        const safeName = name || "User";
        const safePhoto = photo || `https://ui-avatars.com/api/?name=${safeName}&background=2dd4bf&color=0b0e14&bold=true`;
        
        document.getElementById('sidebar-username').innerText = safeName;
        document.getElementById('sidebar-avatar').src = safePhoto;
        
        document.getElementById('main-profile-name').innerText = safeName;
        document.getElementById('main-profile-avatar').src = safePhoto;
    }

    function showApp() {
        document.getElementById('auth-wrapper').style.display = 'none';
        const app = document.getElementById('app-wrapper');
        app.style.display = 'flex';
        if(window.innerWidth < 768) app.style.flexDirection = 'column';
        initDateControls();
        window.addEventListener('resize', () => { if(currentTab==='dashboard') updateUI(); });
    }

    // ==========================================
    // DATA LOGIC (CLOUD + LOCAL) - SMART MERGE
    // ==========================================
    async function loadData() {
        // 1. Define Master List
        const defaultAccounts = ["Cash", "UPI", "GPay", "PhonePe", "Paytm", "Card", "Credit Card", "NetBanking"];

        // 2. Load Local
        const localData = localStorage.getItem('budget_data_local');
        
        // Initialize
        window.transactions = [];
        window.goals = [];
        window.bills = [];
        window.accounts = [...defaultAccounts]; 

        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                window.transactions = parsed.transactions || [];
                window.goals = parsed.goals || [];
                window.bills = parsed.bills || [];
                
                // Smart Merge Accounts
                if(parsed.accounts && parsed.accounts.length > 0) {
                    const combined = new Set([...parsed.accounts, ...defaultAccounts]);
                    window.accounts = Array.from(combined);
                }
                
                updateUI();
                if(window.renderBills) window.renderBills();
                if(window.renderAccounts) window.renderAccounts();
                if(window.renderGoals) window.renderGoals();
                if(window.checkBillAlerts) window.checkBillAlerts();
            } catch(e) { console.error("Local Parse Error", e); }
        }

        // 3. Check Cloud
        if(!currentUserUID) return;
        
        const loader = document.getElementById('loader');
        if(loader) loader.style.display = 'inline-block';

        try {
            const docRef = window.firebaseModules.doc(db, "users", currentUserUID);
            const docSnap = await window.firebaseModules.getDoc(docRef);
            
            if (docSnap.exists()) {
                const cloudData = docSnap.data();
                
                window.goals = cloudData.goals || [];
                window.bills = cloudData.bills || [];
                
                // Cloud Merge for Accounts
                if(cloudData.accounts && cloudData.accounts.length > 0) {
                     const combined = new Set([...cloudData.accounts, ...window.accounts]);
                     window.accounts = Array.from(combined);
                }

                // Sync Transactions
                const cloudTx = cloudData.transactions || [];
                const txMap = new Map();
                cloudTx.forEach(t => txMap.set(t.id, t));
                window.transactions.forEach(t => { if(!txMap.has(t.id)) txMap.set(t.id, t); });
                window.transactions = Array.from(txMap.values());

                // Update Local Storage
                saveData(); 
                
                updateUI();
                if(window.renderBills) window.renderBills();
                if(window.renderAccounts) window.renderAccounts();
                if(window.renderGoals) window.renderGoals();
            } 
        } catch (e) { console.error("Cloud Load Error", e); }
        
        if(loader) loader.style.display = 'none';
        if(typeof initCurrency === 'function') initCurrency();
    }

    async function saveData() {
        if(typeof updateUI === 'function') updateUI(); 
        
        const localObj = {
            transactions: window.transactions || [],
            goals: window.goals || [],
            bills: window.bills || [],        
            accounts: window.accounts || [],  
            lastUpdated: new Date().toISOString()
        };
        localStorage.setItem('budget_data_local', JSON.stringify(localObj));
        console.log("Local Save Complete");

        if(currentUserUID) {
            try {
                await window.firebaseModules.setDoc(window.firebaseModules.doc(db, "users", currentUserUID), { 
                    transactions: window.transactions || [],
                    goals: window.goals || [],
                    bills: window.bills || [],       
                    accounts: window.accounts || [], 
                    lastUpdated: new Date()
                }, { merge: true });
                console.log("Cloud Sync Complete");
            } catch(e) { 
                console.warn("Cloud Save Failed:", e); 
            }
        }
    }

    window.resetData = function() {
        if(confirm("Are you sure? This deletes ALL data from Cloud & Device.")) {
            window.transactions = [];
            window.goals = [];
            window.bills = [];
            window.accounts = ["Cash"]; 
            localStorage.removeItem('budget_data_local');
            saveData(); 
            alert("All data reset.");
            location.reload();
        }
    }

    // --- THEME DATA & HELPERS ---
    const expCategories = ["Groceries", "Dining Out", "Fuel", "Transport", "Utilities", "Shopping", "Entertainment", "Health", "Bills", "Education", "Other"];
    const incCategories = ["Salary", "Bonus", "Investment", "Gift", "Sale", "Lottery", "Other"];
    let currentChartType = 'donut';

    function getCategoryIcon(text) {
        const lower = text.toLowerCase();
        if(lower.includes("fuel")||lower.includes("gas")) return "fa-gas-pump";
        if(lower.includes("car")||lower.includes("uber")||lower.includes("transport")) return "fa-car";
        if(lower.includes("food")||lower.includes("dining")) return "fa-utensils";
        if(lower.includes("coffee")) return "fa-mug-hot";
        if(lower.includes("grocer")||lower.includes("shop")||lower.includes("sale")) return "fa-basket-shopping";
        if(lower.includes("rent")||lower.includes("home")) return "fa-house";
        if(lower.includes("electric")||lower.includes("power")||lower.includes("bill")) return "fa-bolt";
        if(lower.includes("water")) return "fa-faucet";
        if(lower.includes("net")||lower.includes("wifi")) return "fa-wifi";
        if(lower.includes("salary")||lower.includes("income")||lower.includes("lottery")||lower.includes("invest")) return "fa-money-bill-wave";
        if(lower.includes("health")||lower.includes("medic")) return "fa-heart-pulse";
        if(lower.includes("entertain")||lower.includes("movie")) return "fa-film";
        if(lower.includes("educat")) return "fa-graduation-cap";
        if(lower.includes("business")) return "fa-briefcase";
        if(lower.includes("gift")) return "fa-gift";
        return "fa-tag"; 
    }

    // ==========================================
    // 1. CURRENCY LOGIC (Native Mode)
    // ==========================================
    let currentCurrency = "INR"; 
    let currentRate = 1; 

    function initCurrency() {
        const loader = document.getElementById('loader');
        if(loader) loader.style.display = 'none';
        updateUI();
    }

    window.changeCurrency = function() {
        // Kept for backward compatibility, but dropdown removed
        updateUI();
    }

    function formatMoney(amount) {
        // Use "en-IN" locale for comma separation like 1,00,000
        const sym = "₹"; 
        return sym + parseFloat(amount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }
    
    function formatCompactMoney(amount) {
        const sym = "₹";
        let val = parseFloat(amount);
        if(val >= 10000000) return sym + (val/10000000).toFixed(1) + "Cr"; 
        if(val >= 100000) return sym + (val/100000).toFixed(1) + "L";     
        if(val >= 1000) return sym + (val/1000).toFixed(1) + "k";
        return sym + val.toFixed(0);
    }

    // --- CORE LOGIC ---
    window.transactions = [];
    let currentTab = 'dashboard';
    let currentManageTab = 'bills';
    let editingId = null;

    function initDateControls() {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        
        const yearSel = document.getElementById('year-select');
        yearSel.innerHTML = "";
        for(let y = yyyy - 2; y <= yyyy + 5; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.innerText = y;
            if(y === yyyy) opt.selected = true;
            yearSel.appendChild(opt);
        }
        document.getElementById('period-select').value = "all_time";
        document.getElementById('custom-start').value = `${yyyy}-${mm}-01`;
        document.getElementById('custom-end').value = today.toLocaleDateString('en-CA');
    }

    window.switchTab = function(tabName, btn) {
        currentTab = tabName;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        if(btn) btn.classList.add('active');
        document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${tabName}`).classList.add('active');
        if (currentTab === 'goals') renderGoals();
        const titles = { 'dashboard': 'Dashboard', 'income': 'Income Details', 'expenses': 'Expense Details', 'records': 'All Records', 'categories': 'Categories', 'profile': 'My Profile' };
        document.getElementById('page-title').innerText = titles[tabName] || 'Budget Pro';
        updateUI();
    }

    window.deleteTx = function(id) {
        if(confirm("Delete entry?")) transactions = transactions.filter(t => t.id !== id);
        saveData();
    }

    // --- EDIT FUNCTION ---
    window.editTx = function(id) {
        const tx = transactions.find(t => t.id === id);
        if(!tx) return;
        editingId = id; 
        openCalc(true); 
        setCalcType(tx.type);
        
        let catName = tx.desc;
        if (tx.desc.includes('(')) {
            catName = tx.desc.split('(')[0].trim();
        }
        document.getElementById('calc-cat').value = catName;

        if(tx.method) document.getElementById('calc-method').value = tx.method;
        
        let note = "";
        if(tx.desc.includes('(')) {
            const match = tx.desc.match(/\(([^)]*)\)/); 
            if (match && match[1]) {
                note = match[1];
            }
        }
        document.getElementById('calc-note').value = note;
        
        calcString = tx.amount.toString();
        updateCalcDisplay();
    }

    // --- CALCULATOR ---
    let calcString = "0";
    let calcType = "expense";

    window.openCalc = function(isEdit = false) {
        document.getElementById('calc-modal').style.display = 'flex';
        
        // Populate Method Dropdown
        const methodSelect = document.getElementById('calc-method');
        if(methodSelect) {
            methodSelect.innerHTML = "";
            const list = (window.accounts && window.accounts.length > 0) ? window.accounts : ["Cash", "UPI", "Card"]; 
            list.forEach(acc => {
                const opt = document.createElement('option');
                opt.value = acc;
                opt.innerText = acc;
                methodSelect.appendChild(opt);
            });
        }

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('calc-date').value = `${yyyy}-${mm}-${dd}`;

        if(!isEdit) {
            editingId = null; 
            setCalcType('expense'); 
            calcString = "0"; 
            document.getElementById('calc-note').value = ""; 
            if(document.getElementById('calc-person')) document.getElementById('calc-person').value = "";
            updateCalcDisplay();
        }
    }

    window.closeCalc = function() { document.getElementById('calc-modal').style.display = 'none'; editingId = null; }

    window.setCalcType = function(type) {
        calcType = type;
        document.getElementById('tab-exp').className = type==='expense'?'calc-tab active expense-tab':'calc-tab';
        document.getElementById('tab-inc').className = type==='income'?'calc-tab active':'calc-tab';
        document.getElementById('tab-debt').className = type==='debt'?'calc-tab active debt-tab':'calc-tab';

        const catSelect = document.getElementById('calc-cat');
        const debtWrapper = document.getElementById('debt-row-wrapper');

        if(type === 'debt') {
            catSelect.style.display = 'none';
            debtWrapper.style.display = 'flex'; 
        } else {
            catSelect.style.display = 'block';
            debtWrapper.style.display = 'none';
            catSelect.innerHTML = "";
            const list = type === 'expense' ? expCategories : incCategories;
            if(list) list.forEach(c => {
                const opt = document.createElement('option'); opt.value = c; opt.innerText = c; catSelect.appendChild(opt);
            });
        }
        updateCalcDisplay();
    }

    window.calcInput = function(val) {
        if(val === 'del') { 
            calcString = calcString.slice(0, -1); 
            if(calcString === "") calcString = "0"; 
        }
        else if(val === 'clear') { 
            calcString = "0"; 
        }
        else if (['+','-','*','/'].includes(val)) {
            const last = calcString.slice(-1);
            if(['+','-','*','/'].includes(last)) {
                calcString = calcString.slice(0, -1) + val; 
            } else {
                calcString += val;
            }
        } else {
            if(calcString === "0" && val !== '.') calcString = val; 
            else calcString += val;
        }
        updateCalcDisplay();
    }

    function updateCalcDisplay() {
        document.getElementById('calc-display').innerText = calcString;
        document.getElementById('calc-display').style.color = calcType === 'income' ? 'var(--primary)' : 'var(--secondary)';
    }

    window.saveCalc = function() {
        try { calcString = eval(calcString).toString(); } catch {}
        const amount = parseFloat(calcString);
        if(!amount || amount <= 0) return alert("Invalid Amount");
        
        const dateVal = document.getElementById('calc-date').value || new Date().toISOString().split('T')[0];
        const method = document.getElementById('calc-method').value;
        const note = document.getElementById('calc-note').value.trim();
        let desc = "", type = calcType;

        if(calcType === 'debt') {
            const person = document.getElementById('calc-person').value.trim();
            if(!person) return alert("Enter Person Name");
            desc = person; 
            const dir = document.getElementById('debt-dir').value;
            type = dir === 'lent' ? 'debt_lent' : 'debt_borrowed';
        } else {
            const cat = document.getElementById('calc-cat').value;
            desc = note ? `${cat} (${note})` : cat;
        }

        const txObj = { id: editingId || Date.now(), date: dateVal, desc, amount: amount, type, method, note };
        
        if(editingId) {
            const idx = window.transactions.findIndex(t => t.id === editingId);
            if(idx > -1) window.transactions[idx] = txObj;
        } else {
            window.transactions.push(txObj);
        }
        window.saveData();
        closeCalc();
    }

    // --- DEBTS ---
    function renderDebts(data) {
        const container = document.getElementById('debts-list-container');
        container.innerHTML = "";
        
        const people = {};
        window.transactions.forEach(t => {
            if(t.type !== 'debt_lent' && t.type !== 'debt_borrowed') return;
            const person = t.desc;
            if(!people[person]) people[person] = { bal: 0, txs: [], lastDate: t.date };
            if(t.type === 'debt_lent') people[person].bal += t.amount;
            else people[person].bal -= t.amount;
            people[person].txs.push(t);
            if(t.date > people[person].lastDate) people[person].lastDate = t.date;
        });

        let totalNet = 0;
        let html = "";

        Object.keys(people).forEach((p, index) => {
            const personData = people[p];
            const val = personData.bal;
            totalNet += val;
            const isLent = val >= 0; 
            const colorClass = isLent ? "lent" : "borrowed";
            const uniqueId = `debt-card-${index}`;
            const formattedAmt = formatMoney(Math.abs(val));
            const today = new Date();
            const lastTxDate = new Date(personData.lastDate);
            const diffTime = Math.abs(today - lastTxDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            const dayText = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : `${diffDays} days ago`;

            let waBtn = "";
            if(isLent && Math.abs(val) > 1) {
                const msg = `Hi ${p}, reminder regarding balance: ${formattedAmt}.`;
                const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
                waBtn = `<button class="btn-mini-action btn-wa" onclick="event.stopPropagation(); window.open('${waUrl}', '_blank')"><i class="fa-brands fa-whatsapp"></i></button>`;
            }

            let histHtml = '';
            personData.txs.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
                const tColor = t.type === 'debt_lent' ? 'var(--secondary)' : 'var(--danger)';
                const tSign = t.type === 'debt_lent' ? '+' : '-';
                let note = t.note || (t.type==='debt_lent'?'Gave':'Got');
                histHtml += `
                    <div class="debt-hist-item">
                        <div style="flex:1;">
                            <div class="debt-hist-date">${t.date}</div>
                            <div style="font-size:0.85rem; color:var(--text-main); margin-top:2px;">${note}</div>
                        </div>
                        <div style="text-align:right; display:flex; align-items:center; gap:12px;">
                            <div style="font-weight:bold; color:${tColor}; font-family:'Consolas'; font-size:0.95rem;">${tSign}${formatMoney(t.amount)}</div>
                            <div style="display:flex; gap:6px;">
                                <button class="hist-action-btn" onclick="event.stopPropagation(); editTx(${t.id})"><i class="fa-solid fa-pen" style="font-size:0.75rem;"></i></button>
                                <button class="hist-action-btn del" onclick="event.stopPropagation(); deleteTx(${t.id})"><i class="fa-solid fa-trash" style="font-size:0.75rem;"></i></button>
                            </div>
                        </div>
                    </div>`;
            });

            html += `
                <div class="debt-card" id="${uniqueId}">
                    <div class="debt-header-main" onclick="toggleDebt('${uniqueId}')">
                        <div style="display:flex; align-items:center;">
                            <div class="debt-avatar">${p.charAt(0).toUpperCase()}</div>
                            <div style="font-weight:700; font-size:1rem;">${p}</div>
                        </div>
                        <div style="display:flex; align-items:center;">
                            <div class="debt-amt ${colorClass}" style="margin-right:8px;">${formattedAmt}</div>
                            <i class="fa-solid fa-chevron-down debt-chevron"></i>
                        </div>
                    </div>
                    <div class="debt-action-row">
                        <div class="debt-days-badge"><i class="fa-regular fa-clock"></i> ${dayText}</div>
                        <div class="debt-btn-group">
                            ${waBtn}
                            <button class="btn-mini-action btn-settle" onclick="event.stopPropagation(); settleDebt('${p}', ${val})">
                                <i class="fa-solid fa-check"></i> Settle
                            </button>
                        </div>
                    </div>
                    <div class="debt-history-container">
                        <div class="debt-hist-header-label">Transaction Log</div>
                        <div class="debt-history-scroll" style="max-height:250px; overflow-y:auto;">${histHtml}</div>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
        const netEl = document.getElementById('debt-net-bal');
        netEl.innerText = formatMoney(totalNet);
        netEl.className = totalNet >= 0 ? "stat-val pos" : "stat-val neg";
    }

    window.toggleDebt = function(id) { document.getElementById(id).classList.toggle('open'); }

    window.settleDebt = function(person, balance) {
        openCalc(); setCalcType('debt');
        document.getElementById('calc-person').value = person;
        calcString = Math.abs(balance).toFixed(2); 
        updateCalcDisplay();
        const dir = balance > 0 ? 'borrowed' : 'lent';
        document.getElementById('debt-dir').value = dir;
        document.getElementById('calc-note').value = "Settlement";
    }

    // --- FILTER ---
    function filterData() {
        const year = parseInt(document.getElementById('year-select').value);
        const period = document.getElementById('period-select').value;
        const customStart = document.getElementById('custom-start').value;
        const customEnd = document.getElementById('custom-end').value;

        const customRow = document.getElementById('custom-date-controls');
        if(period === 'custom') customRow.classList.add('show'); else customRow.classList.remove('show');

        return window.transactions.filter(t => {
            if (period === 'all_time') return true;
            const txDate = new Date(t.date);
            const txY = txDate.getFullYear();
            const txM = txDate.getMonth();
            
            if(period === 'custom') {
                if(!customStart || !customEnd) return true;
                return t.date >= customStart && t.date <= customEnd;
            }
            if(period === 'week') {
                const now = new Date();
                const day = now.getDay() || 7; 
                if(day !== 1) now.setHours(-24 * (day - 1));
                const startOfWeek = new Date(now); startOfWeek.setHours(0,0,0,0);
                const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(endOfWeek.getDate() + 6); endOfWeek.setHours(23,59,59,999);
                return txDate >= startOfWeek && txDate <= endOfWeek;
            }
            if(txY !== year) return false;
            if(period === 'all') return true;
            if(period === 'q1') return txM >= 0 && txM <= 2;
            if(period === 'q2') return txM >= 3 && txM <= 5;
            if(period === 'q3') return txM >= 6 && txM <= 8;
            if(period === 'q4') return txM >= 9 && txM <= 11;
            const monthIdx = parseInt(period);
            if(!isNaN(monthIdx)) return txM === monthIdx;
            return true;
        });
    }

    window.setDailyReminder = function() {
        const title = "Update Budget Tracker";
        const details = "Time to add your daily expenses and income!";
        const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(details)}&recur=RRULE:FREQ=DAILY`;
        window.open(url, '_blank');
    }

   window.updateUI = function() {
        const periodEl = document.getElementById('period-select');
        const yearSelect = document.getElementById('year-select');
        if(periodEl && yearSelect) {
            yearSelect.style.display = (periodEl.value === 'all_time') ? 'none' : 'block';
        }

        const filtered = filterData();
        let realIncome = 0; let realExpense = 0; let cashIn = 0; let cashOut = 0;
        let totalLent = 0; let totalBorrowed = 0;
        
        filtered.forEach(t => {
            if (t.type === 'income') { realIncome += t.amount; cashIn += t.amount; } 
            else if (t.type === 'expense') { realExpense += t.amount; cashOut += t.amount; }
            else if (t.type === 'debt_lent') { cashOut += t.amount; totalLent += t.amount; }
            else if (t.type === 'debt_borrowed') { cashIn += t.amount; totalBorrowed += t.amount; }
        });

        if(document.getElementById('total-inc')) {
            document.getElementById('total-inc').innerText = formatMoney(realIncome);
            document.getElementById('total-exp').innerText = formatMoney(realExpense);
            document.getElementById('balance').innerText = formatMoney(cashIn - cashOut);
            
            const netOutstanding = totalLent - totalBorrowed;
            const outEl = document.getElementById('total-outstanding');
            const prefix = netOutstanding > 0 ? "+" : ""; 
            outEl.innerText = prefix + formatMoney(netOutstanding);
            if (netOutstanding > 0) outEl.style.color = "#10b981"; 
            else if (netOutstanding < 0) outEl.style.color = "#ef4444"; 
            else outEl.style.color = "var(--text-main)"; 

            document.getElementById('profile-total-tx').innerText = filtered.length;
        }

        if(currentTab === 'dashboard') {
            const chartData = filtered.filter(t => t.type === 'income' || t.type === 'expense');
            renderExpenseFlow(chartData);
            if(currentChartType === 'donut') renderSpendingDonut(chartData);
            else if(currentChartType === 'sunburst') renderSpendingSunburst(chartData);
            else if(currentChartType === 'bar') renderSpendingBar(chartData); 
        } 
        else if (currentTab === 'debts') renderDebts(window.transactions); 
        else if (currentTab === 'records') renderRecordsList(filtered);
        else if (currentTab === 'income') renderDetailList(filtered, 'income');
        else if (currentTab === 'expenses') renderDetailList(filtered, 'expense');
        else if (currentTab === 'categories') {
            if (!currentManageTab) currentManageTab = 'cats'; 
            if (currentManageTab === 'cats') renderCategories(filtered);
            else if (currentManageTab === 'bills') renderBills();
            else if (currentManageTab === 'accounts') renderAccounts();
        }
        else if (currentTab === 'goals') renderGoals();
    }

    window.switchChartType = function(type, btn) {
        currentChartType = type;
        document.querySelectorAll('.chart-switch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateUI();
    }

    // --- CHART RENDERERS ---
    function renderSpendingBar(data) {
        const container = document.getElementById('chart-cats');
        const tooltip = document.getElementById('cat-tooltip');
        container.innerHTML = ""; container.appendChild(tooltip);

        const map = {}; 
        data.filter(t => t.type === 'expense').forEach(t => { 
            const val = t.amount; 
            let catName = t.desc.split('(')[0].trim(); 
            map[catName] = (map[catName] || 0) + val; 
        });
        
        const sorted = Object.keys(map).map(k => ({name: k, val: map[k]})).sort((a,b) => b.val - a.val).slice(0, 10);
        if(sorted.length === 0) { container.innerHTML += "<div class='empty-state' style='padding-top:100px;'>No expenses</div>"; return; }

        const isMobile = window.innerWidth < 768;
        const margin = {top: 20, right: 10, bottom: 40, left: isMobile ? 35 : 50}; 
        const width = container.clientWidth - margin.left - margin.right;
        const height = (isMobile ? 300 : ((container.clientHeight || 400) - 20)) - margin.top - margin.bottom;

        const svg = d3.select("#chart-cats").append("svg").attr("width", width + margin.left + margin.right).attr("height", height + margin.top + margin.bottom).append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        const x = d3.scaleBand().range([0, width]).domain(sorted.map(d => d.name)).padding(0.3);
        const y = d3.scaleLinear().domain([0, d3.max(sorted, d => d.val)]).range([height, 0]);
        const colors = d3.scaleOrdinal(d3.schemeSpectral[sorted.length > 2 ? sorted.length : 3]);

        svg.selectAll(".bar").data(sorted).enter().append("rect").attr("class", "bar").attr("x", d => x(d.name)).attr("width", x.bandwidth()).attr("y", d => y(d.val)).attr("height", d => height - y(d.val)).attr("rx", 4).attr("fill", (d, i) => colors(i)).style("opacity", 0.8)
            .on("mouseover", function(event, d) {
                d3.select(this).style("opacity", 1);
                tooltip.style.opacity = 1; tooltip.innerHTML = `<strong>${d.name}</strong><br>${formatMoney(d.val)}`;
                const [mx, my] = d3.pointer(event, container); tooltip.style.left = `${mx}px`; tooltip.style.top = `${my - 40}px`;
            })
            .on("mouseout", function() { d3.select(this).style("opacity", 0.8); tooltip.style.opacity = 0; });

        if (!isMobile || x.bandwidth() > 20) {
            svg.selectAll(".label").data(sorted).enter().append("text").text(d => formatCompactMoney(d.val)).attr("x", d => x(d.name) + x.bandwidth() / 2).attr("y", d => y(d.val) - 5).attr("text-anchor", "middle").style("fill", "var(--text-main)").style("font-size", isMobile ? "9px" : "10px").style("font-weight", "bold");
        }
        svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickSize(0)).selectAll("text").style("text-anchor", "middle").style("fill", "var(--text-muted)").style("font-size", isMobile ? "9px" : "10px").attr("dy", "1em").text(function(d) { return (isMobile && d.length > 4) ? d.substring(0,4)+".." : d; });
        svg.selectAll(".domain").remove();
    }

    function renderExpenseFlow(data) {
        const container = document.getElementById('chart-flow');
        container.innerHTML = "";
        
        const dateMap = {};
        data.filter(t => t.type === 'expense').forEach(t => {
            dateMap[t.date] = (dateMap[t.date] || 0) + t.amount;
        });

        const sortedDates = Object.keys(dateMap).sort();
        if(sortedDates.length === 0) {
            container.innerHTML = "<div style='text-align:center; color:var(--text-muted); padding-top:80px;'>No expense data</div>";
            document.getElementById('flow-daily-container').innerHTML = "";
            return; 
        }

        const chartData = sortedDates.map(date => ({ date: new Date(date), val: dateMap[date] }));
        const width = container.clientWidth; const height = container.clientHeight;
        const margin = {top: 10, right: 10, bottom: 20, left: 30};
        const svg = d3.select("#chart-flow").append("svg").attr("width", width).attr("height", height);
        const x = d3.scaleTime().domain(d3.extent(chartData, d => d.date)).range([margin.left, width - margin.right]);
        const y = d3.scaleLinear().domain([0, d3.max(chartData, d => d.val) * 1.1]).range([height - margin.bottom, margin.top]);

        const defs = svg.append("defs");
        const gradient = defs.append("linearGradient").attr("id", "area-gradient").attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
        gradient.append("stop").attr("offset", "0%").attr("stop-color", "var(--danger)").attr("stop-opacity", 0.5);
        gradient.append("stop").attr("offset", "100%").attr("stop-color", "var(--danger)").attr("stop-opacity", 0);

        const area = d3.area().curve(d3.curveMonotoneX).x(d => x(d.date)).y0(height - margin.bottom).y1(d => y(d.val));
        const line = d3.line().curve(d3.curveMonotoneX).x(d => x(d.date)).y(d => y(d.val));

        svg.append("path").datum(chartData).attr("fill", "url(#area-gradient)").attr("d", area);
        svg.append("path").datum(chartData).attr("fill", "none").attr("stroke", "var(--danger)").attr("stroke-width", 2).attr("d", line);
        const tooltip = document.getElementById('flow-tooltip');
        svg.selectAll(".dot").data(chartData).enter().append("circle").attr("cx", d => x(d.date)).attr("cy", d => y(d.val)).attr("r", 5).attr("fill", "var(--bg-body)").attr("stroke", "var(--danger)").attr("stroke-width", 2).style("cursor", "pointer")
            .on("mouseover", function(event, d) { d3.select(this).attr("r", 8).attr("fill", "var(--danger)"); tooltip.style.opacity = 1; tooltip.innerHTML = `<strong>${d.date.toLocaleDateString()}</strong><br>${formatMoney(d.val)}`; const [mx, my] = d3.pointer(event, document.querySelector('.flow-container')); tooltip.style.left = `${mx}px`; tooltip.style.top = `${my - 40}px`; })
            .on("mouseout", function() { d3.select(this).attr("r", 5).attr("fill", "var(--bg-body)"); tooltip.style.opacity = 0; });

        const strip = document.getElementById('flow-daily-container'); strip.innerHTML = "";
        [...chartData].reverse().forEach(d => {
            const div = document.createElement('div'); div.className = 'flow-daily-item';
            div.innerHTML = `<div class="flow-day">${d.date.toLocaleDateString('en-US', { weekday: 'short' })}</div><div class="flow-date">${d.date.getDate()}</div><div class="flow-amt">${formatCompactMoney(d.val)}</div>`;
            strip.appendChild(div);
        });
    }

    function relaxLabels(labels, spacing) {
        let right = labels.filter(l => l.pos[0] > 0).sort((a,b) => a.pos[1] - b.pos[1]);
        let left = labels.filter(l => l.pos[0] < 0).sort((a,b) => a.pos[1] - b.pos[1]);
        function relaxSide(group) {
            for(let i=0; i<group.length; i++) {
                if(i > 0) {
                    let prev = group[i-1];
                    if(group[i].pos[1] < prev.pos[1] + spacing) group[i].pos[1] = prev.pos[1] + spacing;
                }
            }
        }
        relaxSide(right); relaxSide(left);
    }

    function getLabelText(name, value, total) {
        const mode = document.getElementById('chart-label-mode').value;
        const percent = ((value / total) * 100).toFixed(1) + "%";
        const valStr = formatCompactMoney(value); 
        if(mode === 'value') return valStr;
        if(mode === 'percent') return percent;
        if(mode === 'all') return `${name}: ${valStr} (${percent})`;
        return name; 
    }

    function renderSpendingDonut(data) {
        const container = document.getElementById('chart-cats');
        const tooltip = document.getElementById('cat-tooltip');
        container.innerHTML = ""; container.appendChild(tooltip);
        const map = {}; data.filter(t => t.type==='expense').forEach(t => { const val = t.amount; let catName = t.desc.split('(')[0].trim(); map[catName] = (map[catName] || 0) + val; });
        const sorted = Object.keys(map).map(k => ({name:k, val:map[k]})).sort((a,b) => b.val - a.val).slice(0, 7);
        if(sorted.length===0) { container.innerHTML += "<div class='empty-state' style='padding-top:100px;'>No expenses</div>"; return; }
        const total = sorted.reduce((a,b)=>a+b.val,0);
        
        const isMobile = window.innerWidth < 768;
        const w = container.clientWidth; const h = isMobile ? 350 : Math.max(container.clientHeight, 400) - 20; 
        const r = Math.min(w, h)/2; const radius = r * (isMobile ? 0.6 : 0.7);

        const svg = d3.select("#chart-cats").append("svg").attr("width", w).attr("height", h).append("g").attr("transform", `translate(${w/2},${h/2})`);
        const colors = d3.scaleOrdinal([getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(), "var(--secondary)", "#a855f7", "#3b82f6", "var(--primary)", "#f97316", "#10b981"]);
        const pie = d3.pie().value(d => d.val).sort(null);
        const arc = d3.arc().innerRadius(radius*0.6).outerRadius(radius).cornerRadius(5);
        const outerArc = d3.arc().innerRadius(radius * 1.1).outerRadius(radius * 1.1);
        const centerName = svg.append("text").attr("dy", "-0.5em").attr("text-anchor","middle").style("font-size","12px").style("fill", "var(--text-muted)").text("Top Spend");
        const centerVal = svg.append("text").attr("dy", "1em").attr("text-anchor","middle").style("font-size", isMobile ? "16px" : "20px").style("fill", "var(--text-main)").style("font-weight","bold").text(formatCompactMoney(total));
        const arcs = svg.selectAll('g.slice').data(pie(sorted)).enter().append('g').attr('class','slice');
        arcs.append('path').attr('d', arc).attr('fill', (d,i) => colors(i)).style("stroke", "var(--bg-body)").style("stroke-width", "2px").on('mouseover', (e, d) => { centerName.text(d.data.name); centerVal.text(formatCompactMoney(d.data.val)); }).on('mouseout', () => { centerName.text("Total"); centerVal.text(formatCompactMoney(total)); });

        const pieData = pie(sorted);
        const labelData = pieData.map(d => {
            const pos = outerArc.centroid(d);
            const midAngle = d.startAngle + (d.endAngle - d.startAngle) / 2;
            pos[0] = radius * (isMobile ? 1.3 : 1.2) * (midAngle < Math.PI ? 1 : -1); 
            return { d: d, pos: pos, midAngle: midAngle };
        });
        relaxLabels(labelData, isMobile ? 10 : 14);
        svg.selectAll("polyline").data(labelData).enter().append("polyline").attr("points", item => [arc.centroid(item.d), outerArc.centroid(item.d), item.pos]).style("fill", "none").style("stroke", "var(--text-muted)").style("stroke-width", "1px").style("opacity", 0.3);
        svg.selectAll("text.label").data(labelData).enter().append("text").attr("dy", ".35em").text(item => getLabelText(item.d.data.name, item.d.data.val, total)).attr("transform", item => `translate(${item.pos})`).style("text-anchor", item => item.midAngle < Math.PI ? "start" : "end").style("font-size", isMobile ? "9px" : "11px").style("fill", "var(--text-muted)");
    }

    function renderSpendingSunburst(data) {
        const container = document.getElementById('chart-cats');
        const tooltip = document.getElementById('cat-tooltip');
        container.innerHTML = ""; container.appendChild(tooltip);
        const rootData = { name: "root", children: [] };
        const catMap = {};
        data.filter(t => t.type==='expense').forEach(t => {
            const val = t.amount;
            let catName = t.desc.split('(')[0].trim();
            let subName = t.desc.includes('(') ? t.desc.match(/\(([^)]+)\)/)[1] : t.desc;
            if(subName === catName) subName = "General";
            if(!catMap[catName]) catMap[catName] = [];
            catMap[catName].push({ name: subName, value: val });
        });
        for(const [key, value] of Object.entries(catMap)) {
            const subMap = {}; value.forEach(v => subMap[v.name] = (subMap[v.name] || 0) + v.value);
            const children = Object.keys(subMap).map(k => ({ name: k, value: subMap[k] }));
            rootData.children.push({ name: key, children: children });
        }
        if(rootData.children.length === 0) { container.innerHTML += "<div class='empty-state' style='padding-top:100px;'>No expenses</div>"; return; }

        const isMobile = window.innerWidth < 768;
        const w = container.clientWidth; const h = isMobile ? 350 : Math.max(container.clientHeight, 400) - 20; 
        const maxRadius = Math.min(w, h) / 2;
        const radius = maxRadius - (isMobile ? 50 : 80); 

        const svg = d3.select("#chart-cats").append("svg").attr("width", w).attr("height", h).append("g").attr("transform", `translate(${w/2},${h/2})`);
        const partition = d3.partition().size([2 * Math.PI, radius]);
        const root = d3.hierarchy(rootData).sum(d => d.value).sort((a, b) => b.value - a.value);
        partition(root);

        const arc = d3.arc().startAngle(d => d.x0).endAngle(d => d.x1).padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005)).padRadius(radius / 2).innerRadius(d => d.depth === 1 ? radius * 0.6 : radius * 0.92).outerRadius(d => d.depth === 1 ? radius * 0.9 : radius);
        const color = d3.scaleOrdinal(d3.schemeSpectral[10]);
        const centerName = svg.append("text").attr("dy", "-0.5em").attr("text-anchor","middle").style("font-size","12px").style("fill", "var(--text-muted)").text("Total");
        const centerVal = svg.append("text").attr("dy", "1em").attr("text-anchor","middle").style("font-size", isMobile?"16px":"18px").style("fill", "var(--text-main)").style("font-weight","bold").text(formatCompactMoney(root.value));

        svg.selectAll("path").data(root.descendants().filter(d => d.depth)).enter().append("path").attr("fill", d => { while (d.depth > 1) d = d.parent; return color(d.data.name); }).attr("d", arc).style("stroke", "var(--bg-body)").style("stroke-width", "1px").on("mouseover", function(e, d) { centerName.text(d.data.name); centerVal.text(formatCompactMoney(d.value)); }).on("mouseout", function() { centerName.text("Total"); centerVal.text(formatCompactMoney(root.value)); });

        const outerNodes = root.descendants().filter(d => d.depth === 2 && (d.x1 - d.x0) > 0.05); 
        const labelData = outerNodes.map(d => {
             const angle = d.x0 + (d.x1 - d.x0) / 2;
             const R = radius * (isMobile ? 1.1 : 1.25); 
             const x = R * Math.sin(angle);
             const y = -R * Math.cos(angle);
             const pos = [x, y];
             pos[0] = R * (x >= 0 ? (isMobile ? 1 : 1.1) : (isMobile ? -1 : -1.1));
             return { d: d, pos: pos, angle: angle };
         });
         relaxLabels(labelData, isMobile ? 12 : 14); 
         svg.selectAll("text.label").data(labelData).enter().append("text").attr("dy", ".35em").style("font-size", isMobile ? "9px" : "11px").style("fill", "var(--text-muted)").text(item => getLabelText(item.d.data.name, item.d.value, root.value)).attr("transform", item => `translate(${item.pos})`).style("text-anchor", item => item.pos[0] > 0 ? "start" : "end");
         svg.selectAll("polyline").data(labelData).enter().append("polyline").style("fill", "none").style("stroke", "var(--text-muted)").style("stroke-width", "1px").style("opacity", 0.3).attr("points", item => { const c = arc.centroid(item.d); const angle = item.angle; const R_mid = radius * (isMobile ? 1.02 : 1.1); const x_mid = R_mid * Math.sin(angle); const y_mid = -R_mid * Math.cos(angle); return [c, [x_mid, y_mid], item.pos]; });
    }

    function renderCategories(data) {
        const catMap = {}; data.forEach(t => { let catName = t.desc.split('(')[0].trim(); if(!catMap[catName]) catMap[catName] = { amount: 0, count: 0 }; catMap[catName].amount += t.amount; });
        const renderList = (cats, divId, color, type) => {
            const container = document.getElementById(divId); let html = '';
            cats.forEach(c => {
                const icon = getCategoryIcon(c);
                const typeSubset = data.filter(t => t.type === type && t.desc.startsWith(c));
                const total = typeSubset.reduce((acc, t) => acc + t.amount, 0);
                const count = typeSubset.length;
                const displayAmt = total > 0 ? formatMoney(total) : "";
                const displayCount = count > 0 ? `${count} txns` : "";
                const valColor = total > 0 ? color : "var(--text-muted)";
                html += `<div class="cat-list-item"><div class="cat-left"><div class="cat-icon-circle" style="background:rgba(255,255,255,0.05); color:${color}"><i class="fa-solid ${icon}"></i></div><div class="cat-name">${c}</div></div><div class="cat-right"><div class="cat-amount" style="color:${valColor}">${displayAmt || "-"}</div><div class="cat-count">${displayCount}</div></div></div>`;
            });
            container.innerHTML = html;
        };
        renderList(incCategories, 'cat-list-income', 'var(--primary)', 'income');
        renderList(expCategories, 'cat-list-expense', 'var(--secondary)', 'expense');
    }

    function renderRecordsList(data) {
        const container = document.getElementById('records-list-container'); data.sort((a,b) => new Date(b.date) - new Date(a.date)); document.getElementById('records-page-total').innerText = data.length + " items";
        if(data.length === 0) { container.innerHTML = `<div class="empty-state">No records found.</div>`; return; }
        
        let html = ''; let lastDate = '';
        data.forEach(t => {
            if(t.date !== lastDate) { const niceDate = new Date(t.date).toLocaleDateString(undefined, {weekday:'long', month:'short', day:'numeric'}); html += `<div class="records-date-header">${niceDate}</div>`; lastDate = t.date; }
            const icon = getCategoryIcon(t.desc); const color = t.type === 'income' ? 'var(--primary)' : 'var(--danger)'; const sign = t.type === 'income' ? '+' : '-'; const methodDisplay = t.method ? `<span class="method-tag">${t.method}</span>` : '';
            html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:15px 0; border-bottom:1px solid rgba(255,255,255,0.03);"><div style="display:flex; align-items:center;"><span class="detail-icon" style="color:${color}"><i class="fa-solid ${icon}"></i></span><div><div style="font-weight:600; font-size:0.95rem;">${t.desc}</div><div style="display:flex; align-items:center; margin-top:3px;"><div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">${t.type}</div>${methodDisplay}</div></div></div><div style="text-align:right;"><div style="font-weight:700; color:${color}">${sign}${formatMoney(t.amount)}</div><div style="display:flex; gap:10px; justify-content:flex-end; margin-top:5px;"><div style="font-size:0.9rem; color:var(--text-muted); cursor:pointer;" onclick="editTx(${t.id})"><i class="fa-solid fa-pen"></i></div><div style="font-size:0.9rem; color:var(--text-muted); cursor:pointer;" onclick="deleteTx(${t.id})"><i class="fa-solid fa-trash"></i></div></div></div></div>`;
        });
        container.innerHTML = html;
    }

    function renderDetailList(data, type) {
        const container = document.getElementById(type === 'income' ? 'income-list-container' : 'expense-list-container'); const subset = data.filter(t => t.type === type).sort((a,b) => new Date(b.date) - new Date(a.date));
        if(subset.length === 0) { container.innerHTML = `<div class="empty-state">No ${type} records.</div>`; return; }
        
        let html = `<table class="detail-table"><thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Amount</th><th style="text-align:right"></th></tr></thead><tbody>`;
        subset.forEach(t => {
            const icon = getCategoryIcon(t.desc); const methodTxt = t.method ? ` <span style="font-size:0.75rem; color:var(--text-muted)">(${t.method})</span>` : '';
            html += `<tr><td>${t.date}</td><td><span class="detail-icon"><i class="fa-solid ${icon}"></i></span> ${t.desc}${methodTxt}</td><td style="text-align:right; font-family:'Consolas'; font-weight:700; color: ${type=='income'?'var(--primary)':'var(--secondary)'}">${formatMoney(t.amount)}</td><td style="text-align:right"><button style="background:none; border:none; color:var(--text-muted); cursor:pointer; margin-right:10px;" onclick="editTx(${t.id})"><i class="fa-solid fa-pen"></i></button><button style="background:none; border:none; color:var(--text-muted); cursor:pointer;" onclick="deleteTx(${t.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    }

    document.addEventListener('keydown', function(event) {
        if(document.getElementById('calc-modal').style.display === 'none') return;
        const key = event.key;
        if(/[0-9]/.test(key) || ['.','+','-','*','/'].includes(key)) { calcInput(key); }
        else if(key === 'Backspace') { calcInput('del'); }
        else if(key === 'Enter') { event.preventDefault(); saveCalc(); }
        else if(key === 'Escape') { closeCalc(); }
    });
    
    window.exportData = function() {
        if (!window.transactions || window.transactions.length === 0) { 
            alert("No data to export!"); 
            return; 
        }
        let csvContent = "Date,Description,Amount (INR),Type,Method\n";
        window.transactions.forEach(t => {
            let cleanDesc = t.desc.replace(/,/g, " "); 
            let amt = parseFloat(t.amount).toFixed(2);
            let row = `${t.date},${cleanDesc},${amt},${t.type},${t.method || ''}`;
            csvContent += row + "\n";
        });
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "budget_data.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    window.handleSearch = function() {
        let query = document.getElementById('search-input').value.trim().toLowerCase();
        const currentData = window.filterData();
        let searchResults = [];
        const match = query.match(/^([<>]=?|=)\s*(\d+(\.\d+)?)$/);
        if (match) {
            const operator = match[1]; const searchVal = parseFloat(match[2]);
            searchResults = currentData.filter(t => {
                const val = t.amount; 
                if (operator === '>') return val > searchVal;
                if (operator === '<') return val < searchVal;
                if (operator === '>=') return val >= searchVal;
                if (operator === '<=') return val <= searchVal;
                if (operator === '=') return Math.abs(val - searchVal) < 0.01; 
                return false;
            });
        } else {
            searchResults = currentData.filter(t => {
                const valStr = t.amount.toFixed(2);
                return t.desc.toLowerCase().includes(query) || valStr.includes(query) || (t.method && t.method.toLowerCase().includes(query));
            });
        }
        renderRecordsList(searchResults);
    };

    window.toggleTheme = function() {
        const body = document.body;
        body.classList.toggle('light-mode');
        const isLight = body.classList.contains('light-mode');
        localStorage.setItem('budget_theme', isLight ? 'light' : 'dark');
        updateThemeUI(isLight);
    }

    function updateThemeUI(isLight) {
        const headerIcon = document.getElementById('header-theme-icon');
        if (headerIcon) {
            headerIcon.className = isLight ? "fa-solid fa-sun" : "fa-solid fa-moon";
            headerIcon.style.color = isLight ? "#f59e0b" : "var(--text-muted)"; 
        }
        const icon = document.getElementById('theme-icon');
        const text = document.getElementById('theme-text');
        const toggle = document.getElementById('theme-toggle-icon');
        if (icon && text && toggle) {
            if (isLight) {
                icon.className = "fa-solid fa-sun"; icon.style.color = "#f59e0b"; text.innerText = "Light Mode"; toggle.className = "fa-solid fa-toggle-on"; toggle.style.color = "var(--primary)";
            } else {
                icon.className = "fa-solid fa-moon"; icon.style.color = "var(--text-main)"; text.innerText = "Dark Mode"; toggle.className = "fa-solid fa-toggle-off"; toggle.style.color = "var(--text-muted)";
            }
        }
    }

    (function initTheme() {
        const savedTheme = localStorage.getItem('budget_theme');
        if(savedTheme === 'light') {
            document.body.classList.add('light-mode');
            setTimeout(() => updateThemeUI(true), 50); 
        }
    })();

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js?v=5').then(reg => console.log('App Installed!', reg.scope)).catch(err => console.log('App Fail:', err));
        });
    }

    window.goals = []; 
    window.renderGoals = function() {
        const container = document.getElementById('goals-list-container');
        if(!container) return;
        container.innerHTML = "";
        if(!window.goals || window.goals.length === 0) { container.innerHTML = "<div class='empty-state'>No goals yet. Click + to add one!</div>"; return; }
        let html = "";
        window.goals.forEach((g, index) => {
            const saved = parseFloat(g.saved) || 0;
            const target = parseFloat(g.target) || 1;
            const percent = Math.min(100, (saved / target) * 100).toFixed(1);
            html += `
                <div class="goal-card">
                    <div class="goal-header">
                        <div class="goal-title"><div class="goal-icon-box"><i class="fa-solid fa-bullseye"></i></div>${g.name}</div>
                        <div style="font-size:0.9rem; font-weight:bold; color:var(--primary);">${percent}%</div>
                    </div>
                    <div class="goal-progress-bg"><div class="goal-progress-fill" style="width:${percent}%"></div></div>
                    <div class="goal-stats"><div>Saved: <span class="goal-current">${formatMoney(saved)}</span></div><div>Target: ${formatMoney(target)}</div></div>
                    <button class="btn-goal-add" onclick="addMoneyToGoal(${index})"><i class="fa-solid fa-circle-plus"></i> Add Money</button>
                    <div style="text-align:center; margin-top:10px;"><span style="font-size:0.7rem; color:var(--danger); cursor:pointer;" onclick="deleteGoal(${index})">Delete Goal</span></div>
                </div>`;
        });
        container.innerHTML = html;
    }

    window.toggleGoalForm = function() {
        const f = document.getElementById('add-goal-form');
        f.style.display = f.style.display === 'block' ? 'none' : 'block';
    }

    window.saveNewGoal = function() {
        const name = document.getElementById('goal-name').value;
        const target = parseFloat(document.getElementById('goal-target').value);
        if(!name || !target) return alert("Please fill details");
        if(!window.goals) window.goals = [];
        window.goals.push({ name, target: target, saved: 0 });
        saveData(); 
        document.getElementById('goal-name').value = "";
        document.getElementById('goal-target').value = "";
        toggleGoalForm();
        renderGoals();
    }

    window.addMoneyToGoal = function(index) {
        const amount = prompt("How much to add?");
        if(amount) {
            const val = parseFloat(amount);
            if(val > 0) {
                window.goals[index].saved += val;
                saveData(); 
                renderGoals();
            }
        }
    }
    
    window.deleteGoal = function(index) {
        if(confirm("Delete this goal?")) {
            window.goals.splice(index, 1);
            saveData(); 
            renderGoals();
        }
    }

    window.autoDetectBillIcon = function() {
        const name = document.getElementById('bill-name').value.toLowerCase();
        const iconSel = document.getElementById('bill-icon');
        const colorSel = document.getElementById('bill-color');
        if(name.includes('netflix') || name.includes('youtube')) { iconSel.value = "fa-film"; colorSel.value = "#e50914"; }
        else if(name.includes('prime') || name.includes('disney') || name.includes('hulu') || name.includes('tv') || name.includes('hotstar')) { iconSel.value = "fa-film"; colorSel.value = "#00a8e8"; }
        else if(name.includes('spotify') || name.includes('music') || name.includes('sound') || name.includes('gaana') || name.includes('jiosaavn')) { iconSel.value = "fa-music"; colorSel.value = "#1db954"; }
        else if(name.includes('apple')) { iconSel.value = "fa-music"; colorSel.value = "#ffffff"; }
        else if(name.includes('wifi') || name.includes('net') || name.includes('fiber') || name.includes('airtel') || name.includes('act') || name.includes('jio')) { iconSel.value = "fa-wifi"; colorSel.value = "#8b5cf6"; }
        else if(name.includes('electric') || name.includes('power') || name.includes('bill') || name.includes('bescom') || name.includes('water') || name.includes('gas')) { iconSel.value = "fa-bolt"; colorSel.value = "#f59e0b"; }
        else if(name.includes('phone') || name.includes('mobile') || name.includes('recharge') || name.includes('prepaid') || name.includes('postpaid')) { iconSel.value = "fa-mobile-screen"; colorSel.value = "#00a8e8"; }
        else if(name.includes('gym') || name.includes('fitness') || name.includes('health') || name.includes('cult') || name.includes('yoga')) { iconSel.value = "fa-dumbbell"; colorSel.value = "#f59e0b"; }
    }

    const presetData = {
        'ott': [
            { name: "Netflix", price: 149, icon: "fa-film", color: "#000000", logo: "https://upload.wikimedia.org/wikipedia/commons/7/75/Netflix_icon.svg" },
            { name: "Prime Video", price: 299, icon: "fa-film", color: "#00A8E1", logo: "https://upload.wikimedia.org/wikipedia/commons/b/b9/Amazon_Prime_Video_logo.svg" },
            { name: "Hotstar", price: 149, icon: "fa-tv", color: "#133ba2", logo: "https://secure-media.hotstarext.com/web-assets/prod/images/brand-logos/disney-hotstar-logo-dark.svg" },
            { name: "YouTube Prem", price: 129, icon: "fa-play", color: "#FF0000", logo: "https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg" },
            { name: "SonyLiv", price: 299, icon: "fa-play", color: "#f05a28", logo: "https://images.samsung.com/is/image/samsung/assets/in/tvs/smart-tv/apps-on-smart-tv/sonyliv.png?$ORIGIN_PNG$" }
        ],
        'music': [
            { name: "Spotify", price: 119, icon: "fa-music", color: "#1DB954", logo: "https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg" },
            { name: "Apple Music", price: 99, icon: "fa-music", color: "#FA243C", logo: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_Music_icon.svg" }, 
            { name: "JioSaavn", price: 99, icon: "fa-music", color: "#2bc5b4", logo: "https://upload.wikimedia.org/wikipedia/commons/e/e8/JioSaavn_Logo.svg" }
        ],
        'internet': [
            { name: "JioFiber", price: 699, icon: "fa-wifi", color: "#0f62fe", logo: "https://upload.wikimedia.org/wikipedia/commons/5/50/Jio_Logo.png" },
            { name: "Airtel", price: 499, icon: "fa-wifi", color: "#ed1c24", logo: "https://upload.wikimedia.org/wikipedia/commons/b/bd/Airtel_logo_2010.svg" },
            { name: "Google One", price: 130, icon: "fa-cloud", color: "#4285F4", logo: "https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" }
        ],
        'utilities': [
            { name: "Electricity", price: 0, icon: "fa-bolt", color: "#F59E0B", logo: "" },
            { name: "Rent", price: 0, icon: "fa-house", color: "#10B981", logo: "" }
        ]
    };

    window.renderCategoryPresets = function() {
        const cat = document.getElementById('preset-cat-select').value;
        const container = document.getElementById('preset-options');
        container.innerHTML = "";
        if(cat === 'manual' || !presetData[cat]) {
            container.style.display = 'none';
            document.getElementById('bill-name').value = "";
            document.getElementById('bill-amount').value = "";
            document.getElementById('bill-logo-url').value = ""; 
            return;
        }
        container.style.display = 'flex';
        presetData[cat].forEach(sub => {
            const chip = document.createElement('div');
            chip.className = 'preset-chip';
            if(sub.logo) chip.innerHTML = `<img src="${sub.logo}" style="width:16px; height:16px; object-fit:contain;"> ${sub.name}`;
            else chip.innerHTML = `<i class="fa-solid ${sub.icon}" style="color:${sub.color}"></i> ${sub.name}`;
            chip.onclick = function() {
                document.getElementById('bill-name').value = sub.name;
                document.getElementById('bill-amount').value = sub.price || "";
                document.getElementById('bill-icon').value = sub.icon;
                document.getElementById('bill-color').value = sub.color;
                document.getElementById('bill-logo-url').value = sub.logo || "";
                document.querySelectorAll('.preset-chip').forEach(c => c.style.borderColor = "var(--glass-border)");
                this.style.borderColor = "var(--primary)";
            };
            container.appendChild(chip);
        });
    }
    
    window.bills = []; 
    
    if (typeof window.billViewDate === 'undefined') {
        window.billViewDate = new Date();
        window.billViewDate.setDate(1); 
    }

    window.getOrdinal = function(n) {
        if (n > 3 && n < 21) return "th"; 
        switch (n % 10) {
            case 1:  return "st";
            case 2:  return "nd";
            case 3:  return "rd";
            default: return "th";
        }
    };

    let currentBillFilter = 'all';

    window.setBillFilter = function(filter, btn) {
        currentBillFilter = filter;
        const parent = btn.parentNode;
        parent.querySelectorAll('.bill-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderBills(); 
    }

    window.changeBillMonth = function(dir) {
        if (!window.billViewDate) {
            window.billViewDate = new Date();
            window.billViewDate.setDate(1);
        }
        window.billViewDate.setDate(1);
        window.billViewDate.setMonth(window.billViewDate.getMonth() + dir);
        renderBills(); 
    };

    window.renderBills = function() {
        const container = document.getElementById('calendar-grid');
        const listContainer = document.getElementById('bills-list-container');
        const title = document.getElementById('cal-month-title');
        const summaryContainer = document.getElementById('cal-summary');
        
        if(!container) return; 
        
        container.innerHTML = ""; 
        listContainer.innerHTML = "";
        
        const year = billViewDate.getFullYear();
        const month = billViewDate.getMonth();
        if(title) title.innerText = billViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
        const currentDay = today.getDate();

        for(let i=0; i<firstDay; i++) container.innerHTML += `<div class="cal-day empty"></div>`;

        for(let d=1; d<=daysInMonth; d++) {
            let dayHtml = `<div class="cal-day ${isCurrentMonth && d === currentDay ? 'today' : ''}">
                              <div>${d}</div>
                              <div class="cal-dot-container" id="day-dots-${d}"></div>
                           </div>`;
            container.innerHTML += dayHtml;
        }

        const safeBills = window.bills || [];
        let countPaid = 0, countOverdue = 0, countUpcoming = 0;

        const processedBills = safeBills.sort((a,b) => a.day - b.day).map(b => {
            const paidTx = window.transactions.find(t => {
                const txDate = new Date(t.date);
                return txDate.getMonth() === month && txDate.getFullYear() === year && t.type === 'expense' && t.desc.toLowerCase().includes(b.name.toLowerCase());
            });
            const isPaid = !!paidTx;
            const isOverdue = !isPaid && isCurrentMonth && b.day < currentDay;
            const isUpcoming = !isPaid && !isOverdue;
            if(isPaid) countPaid++; else if(isOverdue) countOverdue++; else countUpcoming++;
            return { ...b, isPaid, isOverdue, isUpcoming, paidBy: paidTx ? paidTx.desc : '' };
        });

        if(summaryContainer) {
            summaryContainer.innerHTML = `
                <div class="cal-sum-item"><div class="cal-icon-dot dot-due"></div> ${countUpcoming} Upcoming</div>
                <div class="cal-sum-item"><div class="cal-icon-dot dot-overdue"></div> ${countOverdue} Overdue</div>
                <div class="cal-sum-item"><div class="cal-icon-dot dot-paid"></div> ${countPaid} Paid</div>
            `;
        }

        let listHtml = "";

        processedBills.forEach(b => {
            const dotContainer = document.getElementById(`day-dots-${b.day}`);
            if(dotContainer) {
                let dotClass = b.isPaid ? 'dot-paid' : (b.isOverdue ? 'dot-overdue' : 'dot-due');
                dotContainer.innerHTML += `<div class="cal-icon-dot ${dotClass}" style="width:5px; height:5px; border-radius:50%;"></div>`;
            }

            let shouldShow = (currentBillFilter === 'all') || (currentBillFilter === 'paid' && b.isPaid) || (currentBillFilter === 'overdue' && b.isOverdue) || (currentBillFilter === 'upcoming' && b.isUpcoming);

            if(shouldShow) {
                const statusText = b.isPaid ? "Paid" : (b.isOverdue ? "Overdue" : "Due");
                const statusClass = b.isPaid ? "status-paid" : (b.isOverdue ? "status-overdue" : "status-due");
                const suffix = getOrdinal(b.day); 

                listHtml += `
                    <div class="bill-card" style="border-left: 4px solid ${b.color};">
                        <div class="bill-left">
                            <div style="width:42px; height:42px; border-radius:12px; background:${b.logo ? 'transparent' : b.color}; display:flex; align-items:center; justify-content:center; color:white; font-size:1.1rem; box-shadow:0 4px 10px rgba(0,0,0,0.1); overflow:hidden; position:relative;">
                                ${b.logo ? `<img src="${b.logo}" style="width:100%; height:100%; object-fit:contain;">` : `<i class="fa-solid ${b.icon}"></i>`}
                            </div>
                            <div>
                                <div style="font-weight:700; font-size:0.95rem; margin-bottom:2px;">${b.name}</div>
                                <div class="${statusClass}" style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:0.7rem;">${statusText} • ${b.day}${suffix}</div>
                            </div>
                        </div>
                        <div class="bill-right">
                            <div class="bill-amount">${formatMoney(b.amount)}</div>
                            ${!b.isPaid ? `<button onclick="payBill('${b.name}', ${b.amount})" style="margin-top:6px; background:rgba(255,255,255,0.1); border:1px solid var(--glass-border); padding:4px 10px; border-radius:6px; font-size:0.75rem; color:var(--text-main); cursor:pointer;">Pay</button>` : `<div style="margin-top:6px; font-size:0.75rem; color:#10b981;"><i class="fa-solid fa-check"></i> Done<div style="font-size:0.6rem; opacity:0.7;">via: "${b.paidBy}"</div></div>`}
                            <div style="margin-top:8px; display:flex; gap:10px; justify-content:flex-end;">
                                <div onclick="editBill('${b.name}', ${b.amount}, ${b.day}, '${b.color}', '${b.icon}', '${b.logo || ''}')" style="font-size:0.65rem; color:var(--text-muted); cursor:pointer; opacity:0.8;">Edit</div>
                                <div onclick="deleteBill('${b.name}')" style="font-size:0.65rem; color:var(--danger); cursor:pointer; opacity:0.8;">Remove</div>
                            </div>
                        </div>
                    </div>`;
            }
        });
        
        if(listHtml === "") listContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.9rem;">No bills found.</div>`;
        else listContainer.innerHTML = listHtml;
    };

   window.editBill = function(name, amount, day, color, icon, logo) {
        deleteBill(name, true); 
        const form = document.getElementById('add-bill-form');
        if(form.style.display === 'none') toggleBillForm();
        
        document.getElementById('bill-name').value = name;
        document.getElementById('bill-amount').value = amount; 
        document.getElementById('bill-day').value = day;
        document.getElementById('bill-color').value = color;
        document.getElementById('bill-icon').value = icon;
        document.getElementById('bill-logo-url').value = logo || "";
        form.scrollIntoView({ behavior: 'smooth' });
    }

    window.switchManageView = function(view, btn) {
        currentManageTab = view;
        if(btn) {
            const parent = btn.parentNode;
            parent.querySelectorAll('.tab-link-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
        const cats = document.getElementById('subview-cats');
        const bills = document.getElementById('subview-bills');
        const accts = document.getElementById('subview-accounts');
        if(cats) cats.style.display = 'none';
        if(bills) bills.style.display = 'none';
        if(accts) accts.style.display = 'none';
        if(view === 'cats' && cats) { cats.style.display = 'block'; renderCategories(filterData()); } 
        else if(view === 'bills' && bills) { bills.style.display = 'block'; if(window.renderBills) window.renderBills(); } 
        else if(view === 'accounts' && accts) { accts.style.display = 'block'; if(window.renderAccounts) window.renderAccounts(); }
    };

    window.toggleBillForm = function() {
        const f = document.getElementById('add-bill-form');
        if(f) f.style.display = (f.style.display === 'block') ? 'none' : 'block';
    };

    window.saveNewBill = function() {
        const name = document.getElementById('bill-name').value;
        const rawAmount = parseFloat(document.getElementById('bill-amount').value);
        const day = parseInt(document.getElementById('bill-day').value);
        const color = document.getElementById('bill-color').value;
        const icon = document.getElementById('bill-icon').value;
        const logo = document.getElementById('bill-logo-url').value;
        if(!name || !rawAmount || !day) return alert("Please fill all details");
        const finalAmount = rawAmount; 
        if(!window.bills) window.bills = [];
        window.bills.push({ name, amount: finalAmount, day, color, icon, logo });
        saveData(); 
        document.getElementById('bill-name').value = "";
        document.getElementById('bill-amount').value = "";
        document.getElementById('bill-logo-url').value = "";
        document.getElementById('add-bill-form').style.display = 'none';
        renderBills(); 
    }

    window.payBill = function(name, amount) {
        openCalc(); setCalcType('expense');
        const catEl = document.getElementById('calc-cat'); if(catEl) catEl.value = "Utilities"; 
        document.getElementById('calc-note').value = name; 
    };

    window.deleteBill = function(name, skipConfirm = false) {
        if(skipConfirm || confirm("Delete subscription?")) {
            window.bills = window.bills.filter(b => b.name !== name);
            saveData();
            window.renderBills();
        }
    };

    window.accounts = ["Cash", "Card", "PhonePe", "GPay", "NetBanking"]; 
    
    window.renderAccounts = function() {
        const container = document.getElementById('accounts-list-container');
        if(!container) return;
        container.innerHTML = "";
        if(!window.accounts) window.accounts = ["Cash"];

        let html = "";

        window.accounts.forEach((acc) => {
            const balanceUSD = window.transactions.reduce((sum, t) => {
                if (t.method !== acc) return sum;
                if (t.type === 'income' || t.type === 'debt_borrowed') return sum + t.amount;
                if (t.type === 'expense' || t.type === 'debt_lent') return sum - t.amount;
                return sum;
            }, 0);

            let icon = "fa-wallet";
            const lower = acc.toLowerCase();
            if(lower.includes("bank")||lower.includes("hdfc")||lower.includes("sbi")) icon="fa-building-columns";
            if(lower.includes("card")||lower.includes("visa")) icon="fa-credit-card";
            if(lower.includes("cash")) icon="fa-money-bill-1";
            if(lower.includes("pay")) icon="fa-mobile-screen-button";

            html += `
                <div class="cat-list-item">
                    <div class="cat-left">
                        <div class="cat-icon-circle" style="background:rgba(251, 191, 36, 0.1); color:var(--secondary);"><i class="fa-solid ${icon}"></i></div>
                        <div class="cat-name">${acc}</div>
                    </div>
                    <div class="cat-right" style="display:flex; align-items:center; gap:10px;">
                        <div style="font-weight:700; font-family:'Consolas'; font-size:0.95rem; color:${balanceUSD >= 0 ? 'var(--text-main)' : 'var(--danger)'}">${formatMoney(balanceUSD)}</div>
                        <button onclick="deleteAccount('${acc}')" style="background:none; border:none; color:var(--text-muted); cursor:pointer; opacity:0.6;"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>`;
        });
        container.innerHTML = html;
    };

    window.toggleAcctForm = function() {
        const f = document.getElementById('add-acct-form');
        if(f) f.style.display = f.style.display === 'block' ? 'none' : 'block';
    };

    window.saveNewAccount = function() {
        const name = document.getElementById('acct-name').value;
        if(!name) return alert("Enter Name");
        window.accounts.push(name);
        saveData();
        toggleAcctForm();
        renderAccounts();
        document.getElementById('acct-name').value = "";
    };

    window.deleteAccount = function(name) {
        if(confirm(`Delete "${name}"?`)) {
            window.accounts = window.accounts.filter(a => a !== name);
            saveData();
            renderAccounts();
        }
    };

    ;(function initBillForm() {
        const sel = document.getElementById('bill-day');
        if(sel) {
            sel.innerHTML = "";
            for(let i=1; i<=31; i++) {
                sel.innerHTML += `<option value="${i}">${i}${getOrdinal(i)}</option>`;
            }
        }
    })();
    
    window.toggleNotifications = function() {
        const btnIcon = document.getElementById('notif-toggle-icon');
        let notificationsEnabled = localStorage.getItem('budget_notif_enabled') === 'true';

        if (!notificationsEnabled) {
            if (!("Notification" in window)) { alert("This browser does not support notifications"); return; }
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    notificationsEnabled = true;
                    localStorage.setItem('budget_notif_enabled', 'true');
                    if(btnIcon) { btnIcon.className = "fa-solid fa-toggle-on"; btnIcon.style.color = "var(--primary)"; }
                    new Notification("Budget Pro", { body: "✅ Notifications enabled! We'll remind you about bills.", icon: "https://cdn-icons-png.flaticon.com/512/2344/2344132.png" });
                    startNotificationTimers();
                } else {
                    alert("Permission denied. Please enable in Browser Settings.");
                }
            });
        } else {
            notificationsEnabled = false;
            localStorage.setItem('budget_notif_enabled', 'false');
            if(btnIcon) { btnIcon.className = "fa-solid fa-toggle-off"; btnIcon.style.color = "var(--text-muted)"; }
            alert("🔕 Notifications muted.");
        }
    }

    function startNotificationTimers() {
        let notificationsEnabled = localStorage.getItem('budget_notif_enabled') === 'true';
        if(!notificationsEnabled) return;
        checkBillAlerts();
        setInterval(() => {
            if(!notificationsEnabled) return; 
            const now = new Date();
            if (now.getHours() === 21 && now.getMinutes() === 0) {
                new Notification("📝 Daily Update", { body: "It's 9 PM! Time to log your daily expenses.", icon: "https://cdn-icons-png.flaticon.com/512/2921/2921222.png" });
            }
        }, 60000);
    }

    window.checkBillAlerts = function() {
        let notificationsEnabled = localStorage.getItem('budget_notif_enabled') === 'true';
        if (!notificationsEnabled || Notification.permission !== "granted") return;
        const today = new Date();
        const currentDay = today.getDate();
        let overdueCount = 0, upcomingCount = 0;
        (window.bills || []).forEach(b => {
            const isPaid = window.transactions.some(t => t.desc.toLowerCase().includes(b.name.toLowerCase()) && new Date(t.date).getMonth() === today.getMonth());
            if(!isPaid) {
                if(b.day < currentDay) overdueCount++;
                else if(b.day >= currentDay && b.day <= currentDay + 3) upcomingCount++;
            }
        });
        if (overdueCount > 0) new Notification("⚠️ Bill Alert", { body: `You have ${overdueCount} overdue bills!` });
        else if (upcomingCount > 0) new Notification("📅 Upcoming Bills", { body: `You have ${upcomingCount} bills due soon.` });
    }

    ;(function initNotifs() {
        const btnIcon = document.getElementById('notif-toggle-icon');
        let notificationsEnabled = localStorage.getItem('budget_notif_enabled') === 'true';
        if(notificationsEnabled) {
            if(btnIcon) { btnIcon.className = "fa-solid fa-toggle-on"; btnIcon.style.color = "var(--primary)"; }
            startNotificationTimers();
        }
    })();
    
    window.reportBug = function() {
        const devEmail = "your-email@gmail.com"; 
        const platform = navigator.platform;
        const userAgent = navigator.userAgent;
        const appVersion = "v1.0"; 
        const subject = encodeURIComponent(`Bug Report: Budget Pro ${appVersion}`);
        const body = encodeURIComponent(`
Please describe the bug:
-----------------------


-----------------------
Technical Info (Do not delete):
Platform: ${platform}
Browser: ${userAgent}
        `);
        window.location.href = `mailto:${devEmail}?subject=${subject}&body=${body}`;
    }
