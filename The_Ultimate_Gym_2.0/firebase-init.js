import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    onSnapshot, 
    orderBy, 
    doc, 
    deleteDoc, 
    updateDoc, 
    where,     // <--- These were missing in your exports
    getDocs,   // <--- These were missing in your exports
    getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Check if config exists
if (!window.firebaseConfig) {
    console.error("CRITICAL ERROR: config.js is missing or not linked in index.html!");
}

const app = initializeApp(window.firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

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
    onSnapshot, 
    orderBy, 
    doc, 
    deleteDoc, 
    updateDoc, 
    where,    // Exporting these now
    getDocs,  // Exporting these now
    getDoc 
};
