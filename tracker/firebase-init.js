// Using the specific version you provided
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// Expose Firebase functions to global scope for the app logic
window.firebaseModules = { initializeApp, getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, getFirestore, doc, getDoc, setDoc };

// Dispatch event to signal Firebase is ready to load
window.dispatchEvent(new Event('firebase-modules-loaded'));
