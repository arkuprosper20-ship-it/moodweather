// MoodWeather Firebase configuration and exports
// If firebaseConfig contains placeholder values, the app runs in DEMO MODE using localStorage.

export const firebaseConfig = {
  apiKey: "AIzaSyBvdq6jnAptb9LXY55GBrxc_heGJrRq6J4",
  authDomain: "pawidhack.firebaseapp.com",
  projectId: "pawidhack",
  storageBucket: "pawidhack.firebasestorage.app",
  messagingSenderId: "64849933348",
  appId: "1:64849933348:web:7ed7e27204d1e754fc14b1",
  measurementId: "G-VFY5R2DDMM"
};

// Detect demo mode: if any required field is missing or clearly a placeholder
function isPlaceholderConfig(config) {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  for (const key of required) {
    const val = config[key];
    if (!val || typeof val !== 'string') return true;
    if (val.includes('YOUR_') || val.includes('REPLACE_') || val === 'demo') return true;
  }
  return false;
}

export const DEMO_MODE = isPlaceholderConfig(firebaseConfig);

// Runtime mode: starts equal to DEMO_MODE, but flips to true when the
// app falls back to demo mode at runtime (Firebase unreachable, project
// not set up, permission denied, offline).
let runtimeDemo = DEMO_MODE;

export function isDemo() {
  return runtimeDemo;
}

export function markDemoFallback() {
  runtimeDemo = true;
}

let app = null;
let auth = null;
let db = null;

export async function initFirebase() {
  if (DEMO_MODE) {
    console.log('[MoodWeather] Running in DEMO MODE (localStorage)');
    return { app: null, auth: null, db: null, demo: true };
  }

  try {
    // Dynamic import of Firebase SDK modules
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    console.log('[MoodWeather] Firebase initialized');
    return { app, auth, db, demo: false };
  } catch (err) {
    console.error('[MoodWeather] Firebase init failed, falling back to demo mode:', err);
    return { app: null, auth: null, db: null, demo: true };
  }
}

export function getFirebase() {
  return { app, auth, db, demo: DEMO_MODE };
}

export function showDemoBanner() {
  if (!document.getElementById('demo-banner')) {
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.className = 'demo-banner';
    banner.textContent = 'Demo mode — data stored locally in your browser';
    document.body.prepend(banner);
  }
}