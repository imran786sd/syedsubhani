// firebase-init.js
// We import the functions from Google's servers
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, doc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Import your config keys
// Ensure config.js defines 'firebaseConfig' as a global variable or object
// Since we are using modules, we need to access the global variable defined in config.js
const firebaseConfig = window.firebaseConfig;

if (!firebaseConfig) {
    console.error("Firebase Config not found! Check if config.js is loaded before this script.");
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Export everything so app.js can use it
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
    onSnapshot, 
    orderBy, 
    doc, 
    deleteDoc, 
    updateDoc
};
