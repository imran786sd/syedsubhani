// firebase-init.js

// 1. Import functions from the SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    where, 
    getDocs, 
    doc, 
    updateDoc, 
    deleteDoc, 
    orderBy, 
    onSnapshot,
    setDoc  // <--- ADDED THIS
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 2. Your Web App's Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDaR4pZPQ7fD68KHmjvH1oxwgseW83ncvA",
    authDomain: "the-ultimate-gym-2.firebaseapp.com",
    projectId: "the-ultimate-gym-2",
    storageBucket: "the-ultimate-gym-2.firebasestorage.app",
    messagingSenderId: "836314437510",
    appId: "1:836314437510:web:aa0066307393e250b6be07"
};

// 3. Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// 4. Export services so app.js can use them
export { 
    auth, 
    db, 
    provider, 
    signInWithPopup, 
    signOut, 
    onAuthStateChanged, 
    collection, 
    addDoc, 
    query, 
    where, 
    getDocs, 
    doc, 
    updateDoc, 
    deleteDoc, 
    orderBy, 
    onSnapshot,
    setDoc // <--- ADDED THIS TO EXPORT
};
