// demo.js - Handles the "Try Demo" mode
// We attach functions to 'window' so app.js can see them easily.

window.isDemoMode = false;

window.startDemoMode = () => {
    window.isDemoMode = true;
    
    // 1. Fake User
    const demoUser = { uid: "demo-user-123", displayName: "Demo Gym Owner" };
    
    // 2. Hide Login, Show App
    document.getElementById("auth-wrapper").style.display = "none";
    document.getElementById("app-wrapper").style.display = "flex";
    
    // 3. Inject Dummy Data directly into the global variables in app.js
    // We access the global variables via 'window' or direct assignment if they are global
    window.dummyMembers = [
        { 
            id: '1', name: 'Rahul Sharma', phone: '9876543210', gender: 'Male', 
            planDuration: '1y', joinDate: '2023-01-01', expiryDate: '2024-01-01', 
            lastPaidAmount: 12000, memberId: 'GYMRAHU001', 
            attendance: ['2023-10-25', '2023-10-26', '2023-10-27'], 
            photo: null, 
            fitnessStats: { currentWeight: 75, startHeight: 175 } 
        },
        { 
            id: '2', name: 'Priya Singh', phone: '9988776655', gender: 'Female', 
            planDuration: '3m', joinDate: '2023-09-01', expiryDate: '2023-10-01', // Expired
            lastPaidAmount: 4500, memberId: 'GYMPRIY002', 
            attendance: [], photo: null, 
            fitnessStats: { currentWeight: 60, startHeight: 165 } 
        },
        { 
            id: '3', name: 'Amit Verma', phone: '7766554433', gender: 'Male', 
            planDuration: '6m', joinDate: '2023-06-15', expiryDate: '2023-12-15', 
            lastPaidAmount: 8000, memberId: 'GYMAMIT003', 
            attendance: ['2023-10-27'], photo: null 
        }
    ];
    
    window.dummyTransactions = [
        { id: 't1', type: 'income', category: 'Membership Fees', amount: 12000, date: '2023-01-01', mode: 'UPI' },
        { id: 't2', type: 'expense', category: 'Rent', amount: 15000, date: '2023-10-01', mode: 'Cash' },
        { id: 't3', type: 'income', category: 'Supplements', amount: 2500, date: '2023-10-05', mode: 'Cash' }
    ];

    // Trigger the app initialization from app.js
    if (window.initApp) {
        window.currentUser = demoUser; // Set the global user
        window.initApp(); 
        
        // Manually trigger renders since we aren't using Firebase listeners
        setTimeout(() => {
            window.members = window.dummyMembers;
            window.transactions = window.dummyTransactions;
            window.renderDashboard();
            window.renderOverview(); 
            window.renderMembersList();
            window.renderAgeCharts();
            window.renderFitnessList();
            window.renderFinanceList();
            alert("🔹 Demo Mode Active\n\nYou can explore the UI, but data changes will NOT be saved to the database.");
        }, 500);
    }
};
