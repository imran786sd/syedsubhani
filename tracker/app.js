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
    async function handleGoogleLogin() {
        const provider = new window.firebaseModules.GoogleAuthProvider();
        try {
            await window.firebaseModules.signInWithPopup(auth, provider);
        } catch (error) {
            alert("Login Failed: " + error.message);
        }
    }

    function handleLogout() {
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
    // DATA LOGIC (CLOUD + LOCAL)
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
                
                // --- THE FIX: Merge Saved Accounts with New Defaults ---
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
        // 1. Update UI immediately
        if(typeof updateUI === 'function') updateUI(); 
        
        // 2. SAVE LOCAL
        const localObj = {
            transactions: window.transactions || [],
            goals: window.goals || [],
            bills: window.bills || [],        // <--- Save Bills
            accounts: window.accounts || [],  // <--- Save Accounts
            lastUpdated: new Date().toISOString()
        };
        localStorage.setItem('budget_data_local', JSON.stringify(localObj));
        console.log("Local Save Complete");

        // 3. SAVE CLOUD (THE IMPORTANT FIX)
        if(currentUserUID) {
            try {
                await window.firebaseModules.setDoc(window.firebaseModules.doc(db, "users", currentUserUID), { 
                    transactions: window.transactions || [],
                    goals: window.goals || [],
                    bills: window.bills || [],       // <--- ADDED THIS
                    accounts: window.accounts || [], // <--- ADDED THIS
                    lastUpdated: new Date()
                }, { merge: true });
                console.log("Cloud Sync Complete");
            } catch(e) { 
                console.warn("Cloud Save Failed:", e); 
            }
        }
    }

    function resetData() {
        if(confirm("Are you sure? This deletes ALL data from Cloud & Device.")) {
            // 1. Clear Memory
            window.transactions = [];
            window.goals = [];
            window.bills = [];
            window.accounts = ["Cash"]; // Reset to default
            
            // 2. Clear Local
            localStorage.removeItem('budget_data_local');
            
            // 3. Clear Cloud (Save empty state)
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
    // 1. CURRENCY LOGIC (Native Mode - No Conversion)
    // ==========================================
    // FIXED: Removed Exchange Rate Math. Rate is locked to 1.
    const symbols = { USD: "$", INR: "₹", EUR: "€", GBP: "£", JPY: "¥", CAD: "C$" };
    let currentCurrency = "INR"; 
    let currentRate = 1; 

    function initCurrency() {
        const savedCurr = localStorage.getItem('budget_currency_pref');
        currentCurrency = savedCurr || "INR";
        
        // Remove dropdown logic since we are locked to INR mostly, 
        // but keep this for symbol display if user changed preference previously.
        const loader = document.getElementById('loader');
        if(loader) loader.style.display = 'none';
        
        updateUI();
    }

    function changeCurrency() {
        currentCurrency = document.getElementById('currency').value;
        localStorage.setItem('budget_currency_pref', currentCurrency);
        updateUI();
    }

    function updateRate() { 
        currentRate = 1; // Locked
        updateUI(); 
    }

    function formatMoney(amount) {
        // Use "en-IN" locale for comma separation like 1,00,000
        const sym = "₹"; // Hardcoded symbol for Native Mode
        return sym + parseFloat(amount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }
    
    function formatCompactMoney(amount) {
        const sym = "₹";
        let val = parseFloat(amount);
        // Indian Number System (Lakhs/Crores)
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

        // FIX: Set default to "all_time" instead of current month
        document.getElementById('period-select').value = "all_time";
        
        document.getElementById('custom-start').value = `${yyyy}-${mm}-01`;
        document.getElementById('custom-end').value = today.toLocaleDateString('en-CA');
    }

    function generateDummyData() {
        transactions = [];
        const today = new Date();
        const methods = ["Card", "PhonePe", "GPay", "Paytm", "NetBanking", "Cash"];
        
        for(let i=60; i>=0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toLocaleDateString('en-CA'); 
            const randMethod = methods[Math.floor(Math.random()*methods.length)];

            if(i % 14 === 0) transactions.push({id: Date.now()+i, date: dateStr, desc: "Salary", amount: 4000, type: "income", method: "NetBanking"});
            
            const amt = Math.floor(Math.random() * 150) + 20;
            const cats = ["Groceries", "Transport", "Dining Out", "Coffee", "Utilities", "Entertainment", "Shopping"];
            const cat = cats[Math.floor(Math.random() * cats.length)];
            const sub = ["", "(Milk)", "(Uber)", "(Movie)", "(Bill)", "(Vegetables)"][Math.floor(Math.random()*6)];
            transactions.push({id: Date.now()+i+1, date: dateStr, desc: cat + (sub ? " " + sub : ""), amount: amt, type: "expense", method: randMethod});
        }
        saveData();
    }

    function switchTab(tabName, btn) {
        currentTab = tabName;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        if(btn) btn.classList.add('active');
        document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${tabName}`).classList.add('active');
        // Inside updateUI...
    if (currentTab === 'goals') renderGoals();
        const titles = { 'dashboard': 'Dashboard', 'income': 'Income Details', 'expenses': 'Expense Details', 'records': 'All Records', 'categories': 'Categories', 'profile': 'My Profile' };
        document.getElementById('page-title').innerText = titles[tabName] || 'Budget Pro';
        updateUI();
    }

    function deleteTx(id) {
        if(confirm("Delete entry?")) transactions = transactions.filter(t => t.id !== id);
        saveData();
    }

    // --- REPAIRED EDIT FUNCTION ---
    function editTx(id) {
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
        
        // FIXED: Show exact amount (No Multiplication)
        calcString = tx.amount.toString();
        updateCalcDisplay();
    }

    // --- CALCULATOR ---
    let calcString = "0";
    let calcType = "expense";

    window.openCalc = function(isEdit = false) {
        document.getElementById('calc-modal').style.display = 'flex';
        
        // --- POPULATE DROPDOWN DYNAMICALLY ---
        const methodSelect = document.getElementById('calc-method');
        if(methodSelect) {
            methodSelect.innerHTML = ""; // Clear old options
            
            // Ensure window.accounts is valid
            const list = (window.accounts && window.accounts.length > 0) 
                         ? window.accounts 
                         : ["Cash", "UPI", "Card"]; 

            list.forEach(acc => {
                const opt = document.createElement('option');
                opt.value = acc;
                opt.innerText = acc;
                methodSelect.appendChild(opt);
            });
        }
        // -------------------------------------

        // Set Date to Today
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('calc-date').value = `${yyyy}-${mm}-${dd}`;

        if(!isEdit) {
            editingId = null; 
            setCalcType('expense'); // Default to Expense
            calcString = "0"; 
            document.getElementById('calc-note').value = ""; 
            if(document.getElementById('calc-person')) document.getElementById('calc-person').value = "";
            updateCalcDisplay();
        }
    }

    function closeCalc() { document.getElementById('calc-modal').style.display = 'none'; editingId = null; }

    window.setCalcType = function(type) {
        calcType = type;
        
        // 1. Highlight Tab
        document.getElementById('tab-exp').className = type==='expense'?'calc-tab active expense-tab':'calc-tab';
        document.getElementById('tab-inc').className = type==='income'?'calc-tab active':'calc-tab';
        document.getElementById('tab-debt').className = type==='debt'?'calc-tab active debt-tab':'calc-tab';

        // 2. Toggle Fields
        const catSelect = document.getElementById('calc-cat');
        const debtWrapper = document.getElementById('debt-row-wrapper');

        if(type === 'debt') {
            catSelect.style.display = 'none';
            debtWrapper.style.display = 'flex'; // Show the Name + Type row
        } else {
            catSelect.style.display = 'block';
            debtWrapper.style.display = 'none';
            
            // Refill Categories
            catSelect.innerHTML = "";
            const list = type === 'expense' ? expCategories : incCategories;
            if(list) list.forEach(c => {
                const opt = document.createElement('option'); opt.value = c; opt.innerText = c; catSelect.appendChild(opt);
            });
        }
        updateCalcDisplay();
    }

    function calcInput(val) {
        if(val === 'del') { 
            calcString = calcString.slice(0, -1); 
            if(calcString === "") calcString = "0"; 
        }
        else if(val === 'clear') { 
            // FIX: Actually reset to 0 instead of writing "clear"
            calcString = "0"; 
        }
        else if (['+','-','*','/'].includes(val)) {
            const last = calcString.slice(-1);
            // Prevent double operators (e.g. 5++5)
            if(['+','-','*','/'].includes(last)) {
                calcString = calcString.slice(0, -1) + val; 
            } else {
                calcString += val;
            }
        } else {
            // Standard number input
            if(calcString === "0" && val !== '.') calcString = val; 
            else calcString += val;
        }
        updateCalcDisplay();
    }

    function calcEval() {
        try {
            if(/[^0-9+\-*/.]/.test(calcString)) return; 
            const result = new Function('return ' + calcString)();
            calcString = parseFloat(result.toFixed(2)).toString();
            updateCalcDisplay();
        } catch(e) { calcString = "Error"; updateCalcDisplay(); }
    }

    function updateCalcDisplay() {
        document.getElementById('calc-display').innerText = calcString;
        document.getElementById('calc-display').style.color = calcType === 'income' ? 'var(--primary)' : 'var(--secondary)';
    }

    // FIXED: Save Exact Amount (No Division)
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
            
            // READ FROM DROPDOWN INSTEAD OF BUTTONS
            const dir = document.getElementById('debt-dir').value;
            type = dir === 'lent' ? 'debt_lent' : 'debt_borrowed';
        } else {
            const cat = document.getElementById('calc-cat').value;
            desc = note ? `${cat} (${note})` : cat;
        }

        const amtUSD = amount; // NO CONVERSION
        const txObj = { id: editingId || Date.now(), date: dateVal, desc, amount: amtUSD, type, method, note };
        
        if(editingId) {
            const idx = window.transactions.findIndex(t => t.id === editingId);
            if(idx > -1) window.transactions[idx] = txObj;
        } else {
            window.transactions.push(txObj);
        }
        window.saveData();
        closeCalc();
    }
function renderDebts(data) {
        const container = document.getElementById('debts-list-container');
        container.innerHTML = "";
        
        const people = {};
        
        // 1. Group Data & Find Totals
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
        
        // --- OPTIMIZED: Use String Variable ---
        let html = "";

        Object.keys(people).forEach((p, index) => {
            const personData = people[p];
            const val = personData.bal;
            totalNet += val;

            const isLent = val >= 0; 
            const colorClass = isLent ? "lent" : "borrowed";
            const uniqueId = `debt-card-${index}`;
            const formattedAmt = formatMoney(Math.abs(val));
            
            // Days Ago Logic
            const today = new Date();
            const lastTxDate = new Date(personData.lastDate);
            const diffTime = Math.abs(today - lastTxDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            const dayText = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : `${diffDays} days ago`;

            // WhatsApp Button Logic
            let waBtn = "";
            if(isLent && Math.abs(val) > 1) {
                const msg = `Hi ${p}, reminder regarding balance: ${formattedAmt}.`;
                const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
                waBtn = `<button class="btn-mini-action btn-wa" onclick="event.stopPropagation(); window.open('${waUrl}', '_blank')"><i class="fa-brands fa-whatsapp"></i></button>`;
            }

            // Build Stylized History List
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
                        <div class="debt-history-scroll" style="max-height:250px; overflow-y:auto;">
                            ${histHtml}
                        </div>
                    </div>
                </div>
            `;
        });

        // --- OPTIMIZED: Update DOM once ---
        container.innerHTML = html;

        const netEl = document.getElementById('debt-net-bal');
        netEl.innerText = formatMoney(totalNet);
        netEl.className = totalNet >= 0 ? "stat-val pos" : "stat-val neg";
    }

    // Toggle Function
    function toggleDebt(id) {
        document.getElementById(id).classList.toggle('open');
    }

    function settleDebt(person, balance) {
        openCalc(); 
        setCalcType('debt');
        
        // Fill Name
        document.getElementById('calc-person').value = person;
        
        // Fill Amount
        calcString = Math.abs(balance).toFixed(2); // No conversion
        updateCalcDisplay();
        
        // Set Dropdown Logic: 
        // If they owe you (+), you are "receiving" (use 'borrowed' logic to reduce balance)
        // If you owe them (-), you are "giving" (use 'lent' logic to reduce balance)
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

        // Show/Hide Custom Date Row
        const customRow = document.getElementById('custom-date-controls');
        if(period === 'custom') customRow.classList.add('show'); else customRow.classList.remove('show');

        return window.transactions.filter(t => {
            // 1. HANDLE "ALL TIME" (The Fix)
            // If All Time is selected, we return TRUE immediately (ignoring the Year dropdown)
            if (period === 'all_time') return true;

            const txDate = new Date(t.date);
            const txY = txDate.getFullYear();
            const txM = txDate.getMonth();
            
            // 2. HANDLE CUSTOM DATE
            if(period === 'custom') {
                if(!customStart || !customEnd) return true;
                return t.date >= customStart && t.date <= customEnd;
            }

            // 3. HANDLE WEEK
            if(period === 'week') {
                const now = new Date();
                const day = now.getDay() || 7; 
                if(day !== 1) now.setHours(-24 * (day - 1));
                const startOfWeek = new Date(now); 
                startOfWeek.setHours(0,0,0,0);
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(endOfWeek.getDate() + 6);
                endOfWeek.setHours(23,59,59,999);
                return txDate >= startOfWeek && txDate <= endOfWeek;
            }

            // 4. CHECK YEAR (For everything else)
            if(txY !== year) return false;

            // 5. CHECK PERIOD (Months/Quarters)
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
function setDailyReminder() {
        // Creates a link to add a recurring 9PM event to Google Calendar
        const title = "Update Budget Tracker";
        const details = "Time to add your daily expenses and income!";
        const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(details)}&recur=RRULE:FREQ=DAILY`;
        
        window.open(url, '_blank');
    }
    // --- UI RENDERING ---
   window.updateUI = function() {
        // --- 1. UI LOGIC: HIDE YEAR IF 'ALL TIME' ---
        const periodEl = document.getElementById('period-select');
        const yearSelect = document.getElementById('year-select');
        
        // Safety check if elements exist
        if(periodEl && yearSelect) {
            const period = periodEl.value;
            yearSelect.style.display = (period === 'all_time') ? 'none' : 'block';
        }

        // --- 2. DATA FILTERING ---
        const filtered = filterData();
        
        // --- 3. CALCULATE TOTALS ---
        let realIncome = 0;    
        let realExpense = 0;   
        let cashIn = 0;        
        let cashOut = 0;
        
        let totalLent = 0;
        let totalBorrowed = 0;
        
        // --- MAIN LOOP (CALCULATE ONLY) ---
        filtered.forEach(t => {
            // A. Income & Expense
            if (t.type === 'income') {
                realIncome += t.amount;
                cashIn += t.amount;
            } 
            else if (t.type === 'expense') {
                realExpense += t.amount;
                cashOut += t.amount;
            }
            // B. Debt Logic
            else if (t.type === 'debt_lent') {
                cashOut += t.amount;       // Money left wallet
                totalLent += t.amount;     // Asset (People owe you)
            }
            else if (t.type === 'debt_borrowed') {
                cashIn += t.amount;        // Money entered wallet
                totalBorrowed += t.amount; // Liability (You owe people)
            }
        });

        // --- 4. UPDATE HTML CARDS ---
        if(document.getElementById('total-inc')) {
            document.getElementById('total-inc').innerText = formatMoney(realIncome);
            document.getElementById('total-exp').innerText = formatMoney(realExpense);
            
            // Wallet Balance
            const netBal = cashIn - cashOut;
            document.getElementById('balance').innerText = formatMoney(netBal);
            
            // Net Outstanding
            const netOutstanding = totalLent - totalBorrowed;
            const outEl = document.getElementById('total-outstanding');
            const prefix = netOutstanding > 0 ? "+" : ""; 
            outEl.innerText = prefix + formatMoney(netOutstanding);
            
            // Color Logic
            if (netOutstanding > 0) outEl.style.color = "#10b981"; // Green
            else if (netOutstanding < 0) outEl.style.color = "#ef4444"; // Red
            else outEl.style.color = "var(--text-main)"; // Gray

            document.getElementById('profile-total-tx').innerText = filtered.length;
        }

        // --- 5. RENDER ACTIVE TAB (DISPLAY LOGIC) ---
        // This MUST be outside the loop!
        if(currentTab === 'dashboard') {
            const chartData = filtered.filter(t => t.type === 'income' || t.type === 'expense');
            renderExpenseFlow(chartData);
            
            // --- UPDATED SWITCH LOGIC ---
            if(currentChartType === 'donut') renderSpendingDonut(chartData);
            else if(currentChartType === 'sunburst') renderSpendingSunburst(chartData);
            else if(currentChartType === 'bar') renderSpendingBar(chartData); // <--- ADD THIS
        } 
        else if (currentTab === 'debts') renderDebts(window.transactions); 
        else if (currentTab === 'records') renderRecordsList(filtered);
        else if (currentTab === 'income') renderDetailList(filtered, 'income');
        else if (currentTab === 'expenses') renderDetailList(filtered, 'expense');
        else if (currentTab === 'categories') {
            // Check which sub-tab is open and refresh ONLY that one
            if (!currentManageTab) currentManageTab = 'cats'; // Safety Default
            
            if (currentManageTab === 'cats') renderCategories(filtered);
            else if (currentManageTab === 'bills') renderBills();
            else if (currentManageTab === 'accounts') renderAccounts();
        }
        else if (currentTab === 'goals') renderGoals();
    }

    function switchChartType(type, btn) {
        currentChartType = type;
        document.querySelectorAll('.chart-switch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateUI();
    }

    // --- CHART RENDERERS ---
    
    // ==========================================
    // NEW: BAR CHART RENDERER
    // ==========================================
    function renderSpendingBar(data) {
        const container = document.getElementById('chart-cats');
        const tooltip = document.getElementById('cat-tooltip');
        container.innerHTML = ""; 
        container.appendChild(tooltip);

        const map = {}; 
        data.filter(t => t.type === 'expense').forEach(t => { 
            const val = t.amount; 
            let catName = t.desc.split('(')[0].trim(); 
            map[catName] = (map[catName] || 0) + val; 
        });
        
        const sorted = Object.keys(map).map(k => ({name: k, val: map[k]})).sort((a,b) => b.val - a.val).slice(0, 10);
        if(sorted.length === 0) { container.innerHTML += "<div class='empty-state' style='padding-top:100px;'>No expenses</div>"; return; }

        // --- MOBILE ADJUSTMENTS ---
        const isMobile = window.innerWidth < 768;
        const margin = {top: 20, right: 10, bottom: 40, left: isMobile ? 35 : 50}; 
        const width = container.clientWidth - margin.left - margin.right;
        const height = (isMobile ? 300 : ((container.clientHeight || 400) - 20)) - margin.top - margin.bottom;
        // --------------------------

        const svg = d3.select("#chart-cats").append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const x = d3.scaleBand().range([0, width]).domain(sorted.map(d => d.name)).padding(0.3);
        const y = d3.scaleLinear().domain([0, d3.max(sorted, d => d.val)]).range([height, 0]);
        const colors = d3.scaleOrdinal(d3.schemeSpectral[sorted.length > 2 ? sorted.length : 3]);

        svg.selectAll(".bar").data(sorted).enter().append("rect")
            .attr("class", "bar")
            .attr("x", d => x(d.name))
            .attr("width", x.bandwidth())
            .attr("y", d => y(d.val))
            .attr("height", d => height - y(d.val))
            .attr("rx", 4)
            .attr("fill", (d, i) => colors(i))
            .style("opacity", 0.8)
            .on("mouseover", function(event, d) {
                d3.select(this).style("opacity", 1);
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${d.name}</strong><br>${formatMoney(d.val)}`;
                const [mx, my] = d3.pointer(event, container);
                tooltip.style.left = `${mx}px`; tooltip.style.top = `${my - 40}px`;
            })
            .on("mouseout", function() { d3.select(this).style("opacity", 0.8); tooltip.style.opacity = 0; });

        if (!isMobile || x.bandwidth() > 20) {
            svg.selectAll(".label").data(sorted).enter().append("text")
                .text(d => formatCompactMoney(d.val))
                .attr("x", d => x(d.name) + x.bandwidth() / 2)
                .attr("y", d => y(d.val) - 5)
                .attr("text-anchor", "middle")
                .style("fill", "var(--text-main)")
                .style("font-size", isMobile ? "9px" : "10px")
                .style("font-weight", "bold");
        }

        svg.append("g").attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x).tickSize(0))
            .selectAll("text")
            .style("text-anchor", "middle")
            .style("fill", "var(--text-muted)")
            .style("font-size", isMobile ? "9px" : "10px")
            .attr("dy", "1em")
            .text(function(d) { return (isMobile && d.length > 4) ? d.substring(0,4)+".." : d; });
            
        svg.selectAll(".domain").remove();
    }

    function renderExpenseFlow(data) {
        const container = document.getElementById('chart-flow');
        container.innerHTML = "";
        
        const dateMap = {};
        data.filter(t => t.type === 'expense').forEach(t => {
            const val = t.amount; // No Conversion
            dateMap[t.date] = (dateMap[t.date] || 0) + val;
        });

        const sortedDates = Object.keys(dateMap).sort();
        if(sortedDates.length === 0) {
            container.innerHTML = "<div style='text-align:center; color:var(--text-muted); padding-top:80px;'>No expense data</div>";
            document.getElementById('flow-daily-container').innerHTML = "";
            return; 
        }

        const chartData = sortedDates.map(date => ({ date: new Date(date), val: dateMap[date] }));
        const width = container.clientWidth;
        const height = container.clientHeight;
        const margin = {top: 10, right: 10, bottom: 20, left: 30};

        const svg = d3.select("#chart-flow").append("svg")
            .attr("width", width).attr("height", height);

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
        
        svg.selectAll(".dot").data(chartData).enter().append("circle")
            .attr("cx", d => x(d.date)).attr("cy", d => y(d.val)).attr("r", 5)
            .attr("fill", "var(--bg-body)").attr("stroke", "var(--danger)").attr("stroke-width", 2)
            .style("cursor", "pointer")
            .on("mouseover", function(event, d) {
                d3.select(this).attr("r", 8).attr("fill", "var(--danger)");
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${d.date.toLocaleDateString()}</strong><br>${formatMoney(d.val)}`; 
                
                const [mx, my] = d3.pointer(event, document.querySelector('.flow-container'));
                tooltip.style.left = `${mx}px`;
                tooltip.style.top = `${my - 40}px`;
            })
            .on("mouseout", function() {
                d3.select(this).attr("r", 5).attr("fill", "var(--bg-body)");
                tooltip.style.opacity = 0;
            });

        const strip = document.getElementById('flow-daily-container');
        strip.innerHTML = "";
        [...chartData].reverse().forEach(d => {
            const div = document.createElement('div');
            div.className = 'flow-daily-item';
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
                    if(group[i].pos[1] < prev.pos[1] + spacing) {
                        group[i].pos[1] = prev.pos[1] + spacing;
                    }
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
        
        const map = {}; 
        data.filter(t => t.type==='expense').forEach(t => { 
            const val = t.amount; 
            let catName = t.desc.split('(')[0].trim(); 
            map[catName] = (map[catName] || 0) + val; 
        });
        
        const sorted = Object.keys(map).map(k => ({name:k, val:map[k]})).sort((a,b) => b.val - a.val).slice(0, 7);
        if(sorted.length===0) { container.innerHTML += "<div class='empty-state' style='padding-top:100px;'>No expenses</div>"; return; }
        
        const total = sorted.reduce((a,b)=>a+b.val,0);
        
        // --- MOBILE ADJUSTMENTS ---
        const isMobile = window.innerWidth < 768;
        const w = container.clientWidth; 
        const h = isMobile ? 350 : Math.max(container.clientHeight, 400) - 20; 
        const r = Math.min(w, h)/2; 
        const radius = r * (isMobile ? 0.6 : 0.7); // Smaller radius on mobile
        // --------------------------

        const svg = d3.select("#chart-cats").append("svg")
            .attr("width", w)
            .attr("height", h)
            .append("g")
            .attr("transform", `translate(${w/2},${h/2})`);
            
        const colors = d3.scaleOrdinal([getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(), "var(--secondary)", "#a855f7", "#3b82f6", "var(--primary)", "#f97316", "#10b981"]);
        
        const pie = d3.pie().value(d => d.val).sort(null);
        const arc = d3.arc().innerRadius(radius*0.6).outerRadius(radius).cornerRadius(5);
        const outerArc = d3.arc().innerRadius(radius * 1.1).outerRadius(radius * 1.1);
        
        // Center Text
        const centerName = svg.append("text").attr("dy", "-0.5em").attr("text-anchor","middle").style("font-size","12px").style("fill", "var(--text-muted)").text("Top Spend");
        const centerVal = svg.append("text").attr("dy", "1em").attr("text-anchor","middle").style("font-size", isMobile ? "16px" : "20px").style("fill", "var(--text-main)").style("font-weight","bold").text(formatCompactMoney(total));

        const arcs = svg.selectAll('g.slice').data(pie(sorted)).enter().append('g').attr('class','slice');
        
        arcs.append('path').attr('d', arc).attr('fill', (d,i) => colors(i))
            .style("stroke", "var(--bg-body)").style("stroke-width", "2px")
            .on('mouseover', (e, d) => { centerName.text(d.data.name); centerVal.text(formatCompactMoney(d.data.val)); })
            .on('mouseout', () => { centerName.text("Total"); centerVal.text(formatCompactMoney(total)); });

        // Labels
        const pieData = pie(sorted);
        const labelData = pieData.map(d => {
            const pos = outerArc.centroid(d);
            const midAngle = d.startAngle + (d.endAngle - d.startAngle) / 2;
            pos[0] = radius * (isMobile ? 1.3 : 1.2) * (midAngle < Math.PI ? 1 : -1); 
            return { d: d, pos: pos, midAngle: midAngle };
        });

        relaxLabels(labelData, isMobile ? 10 : 14); // Tighter spacing on mobile

        svg.selectAll("polyline").data(labelData).enter().append("polyline")
           .attr("points", item => [arc.centroid(item.d), outerArc.centroid(item.d), item.pos])
           .style("fill", "none").style("stroke", "var(--text-muted)").style("stroke-width", "1px").style("opacity", 0.3);

        svg.selectAll("text.label").data(labelData).enter().append("text")
           .attr("dy", ".35em")
           .text(item => getLabelText(item.d.data.name, item.d.data.val, total))
           .attr("transform", item => `translate(${item.pos})`)
           .style("text-anchor", item => item.midAngle < Math.PI ? "start" : "end")
           .style("font-size", isMobile ? "9px" : "11px") // Smaller font
           .style("fill", "var(--text-muted)");
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

        // --- MOBILE ADJUSTMENTS ---
        const isMobile = window.innerWidth < 768;
        const w = container.clientWidth; 
        const h = isMobile ? 350 : Math.max(container.clientHeight, 400) - 20; 
        
        const maxRadius = Math.min(w, h) / 2;
        const radius = maxRadius - (isMobile ? 50 : 80); 
        // --------------------------

        const svg = d3.select("#chart-cats").append("svg")
            .attr("width", w).attr("height", h)
            .append("g").attr("transform", `translate(${w/2},${h/2})`);

        const partition = d3.partition().size([2 * Math.PI, radius]);
        const root = d3.hierarchy(rootData).sum(d => d.value).sort((a, b) => b.value - a.value);
        partition(root);

        const arc = d3.arc()
            .startAngle(d => d.x0).endAngle(d => d.x1)
            .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005)).padRadius(radius / 2)
            .innerRadius(d => d.depth === 1 ? radius * 0.6 : radius * 0.92)
            .outerRadius(d => d.depth === 1 ? radius * 0.9 : radius);

        const color = d3.scaleOrdinal(d3.schemeSpectral[10]);

        // Center Text
        const centerName = svg.append("text").attr("dy", "-0.5em").attr("text-anchor","middle").style("font-size","12px").style("fill", "var(--text-muted)").text("Total");
        const centerVal = svg.append("text").attr("dy", "1em").attr("text-anchor","middle").style("font-size", isMobile?"16px":"18px").style("fill", "var(--text-main)").style("font-weight","bold").text(formatCompactMoney(root.value));

        svg.selectAll("path").data(root.descendants().filter(d => d.depth)).enter().append("path")
            .attr("fill", d => { while (d.depth > 1) d = d.parent; return color(d.data.name); })
            .attr("d", arc).style("stroke", "var(--bg-body)").style("stroke-width", "1px")
            .on("mouseover", function(e, d) { centerName.text(d.data.name); centerVal.text(formatCompactMoney(d.value)); })
            .on("mouseout", function() { centerName.text("Total"); centerVal.text(formatCompactMoney(root.value)); });

         // --- LABELS ---
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
 
         svg.selectAll("text.label").data(labelData).enter().append("text")
             .attr("dy", ".35em")
             .style("font-size", isMobile ? "9px" : "11px") 
             .style("fill", "var(--text-muted)")
             .text(item => getLabelText(item.d.data.name, item.d.value, root.value))
             .attr("transform", item => `translate(${item.pos})`)
             .style("text-anchor", item => item.pos[0] > 0 ? "start" : "end");
 
         svg.selectAll("polyline").data(labelData).enter().append("polyline")
             .style("fill", "none").style("stroke", "var(--text-muted)").style("stroke-width", "1px").style("opacity", 0.3)
             .attr("points", item => {
                 const c = arc.centroid(item.d);
                 const angle = item.angle; 
                 const R_mid = radius * (isMobile ? 1.02 : 1.1); 
                 const x_mid = R_mid * Math.sin(angle);
                 const y_mid = -R_mid * Math.cos(angle);
                 return [c, [x_mid, y_mid], item.pos];
             });
    }

    // ==========================================
    // 🐞 REPORT BUG FUNCTION
    // ==========================================
    window.reportBug = function() {
        // REPLACE THIS WITH YOUR EMAIL
        const devEmail = "your-email@gmail.com"; 
        
        // Auto-detect device info to help you debug
        const platform = navigator.platform;
        const userAgent = navigator.userAgent;
        const appVersion = "v1.0"; // You can change this when you update the app
        
        const subject = encodeURIComponent(`Bug Report: Budget Pro ${appVersion}`);
        const body = encodeURIComponent(`
Please describe the bug:
-----------------------


-----------------------
Technical Info (Do not delete):
Platform: ${platform}
Browser: ${userAgent}
        `);

        // Open Email Client
        window.location.href = `mailto:${devEmail}?subject=${subject}&body=${body}`;
    }
</script>
</body>
</html>
