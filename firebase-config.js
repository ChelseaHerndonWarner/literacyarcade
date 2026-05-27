// Firebase App
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

// Authentication
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Firestore Database
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Analytics (optional)
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyAxgYnqWYGAF8vgKeTfliDY76jRqVYy7_w",
  authDomain: "literacy-arcade.firebaseapp.com",
  projectId: "literacy-arcade",
  storageBucket: "literacy-arcade.firebasestorage.app",
  messagingSenderId: "628621471724",
  appId: "1:628621471724:web:7ddfd231d1261b6c781ac9",
  measurementId: "G-LNWHB69FV1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Services
const auth = getAuth(app);
const db = getFirestore(app);
const analytics = getAnalytics(app);

// Export services
export { auth, db };
