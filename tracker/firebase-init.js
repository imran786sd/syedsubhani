// ✅ FIXED: Using a valid, stable Firebase version (10.13.1)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged,signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

// Expose Firebase functions to global scope
window.firebaseModules = { 
    initializeApp, 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    signOut, 
    onAuthStateChanged, 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc,
    signInAnonymously
};

// Dispatch event to signal Firebase is ready
window.dispatchEvent(new Event('firebase-modules-loaded'));
console.log("Firebase Modules Loaded Successfully");
