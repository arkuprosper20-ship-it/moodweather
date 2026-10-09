// MoodWeather data layer — abstracts Firebase Firestore and localStorage demo mode.
// Provides a unified API for the UI code regardless of backend.
//
// Mode is decided once at startup:
//   - If the Firebase config contains placeholders -> demo mode (localStorage).
//   - Otherwise -> try Firebase. If any Firestore operation fails (project not
//     set up, permission denied, offline), the app gracefully falls back to
//     demo mode and shows the "Demo mode" banner.

import { DEMO_MODE, initFirebase, getFirebase, showDemoBanner, markDemoFallback } from './firebase.js';
import { DEMO_SCHOOL, generateDemoSummaries, DEMO_STAFF, MOODS, MOOD_ORDER, TAGS, dateStrOf } from './demo-data.js';

const LS_PREFIX = 'moodweather_';
export const MIN_GROUP_SIZE = 5;

// ---------- Mode ----------

let mode = DEMO_MODE ? 'demo' : 'firebase';
let firebaseReady = null;

async function ensureFirebase() {
  if (mode === 'demo') return { demo: true };
  if (!firebaseReady) {
    firebaseReady = initFirebase().then(async (result) => {
      if (result.demo) return result;
      // Probe Firestore reachability so the mode is decided
      // before the first real operation (sign-in, join, ...).
      // Reading a (possibly missing) schools doc is allowed for
      // everyone, so a successful read means Firestore is live.
      try {
        const { db } = getFirebase();
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await getDoc(doc(db, 'schools', '_reachability_probe'));
        return result;
      } catch (err) {
        return { app: null, auth: null, db: null, demo: true };
      }
    });
  }
  const result = await firebaseReady;
  if (result.demo) {
    useDemoFallback();
  }
  return result;
}

function useDemoFallback() {
  if (mode !== 'demo') {
    mode = 'demo';
    markDemoFallback();
    demoSeedIfNeeded();
    showDemoBanner();
  }
}

// ---------- localStorage demo backend ----------

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(LS_PREFIX + key)); } catch { return null; }
}

function lsSet(key, val) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch { /* quota */ }
}

function lsRemove(key) {
  try { localStorage.removeItem(LS_PREFIX + key); } catch { /* ignore */ }
}

function demoSeedIfNeeded() {
  const today = todayStr();
  if (lsGet('seedDate') !== today) {
    lsSet('school', DEMO_SCHOOL);
    lsSet('summaries', generateDemoSummaries());
    lsSet('staff', DEMO_STAFF);
    lsSet('limits', {});
    // Keep handled alerts across days so "Mark as handled" persists.
    if (!lsGet('handled')) lsSet('handled', {});
    lsSet('seedDate', today);
  }
}

function generateDeviceToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token, dateStr) {
  const msg = token + '|' + dateStr;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch { /* fall back below */ }
  }
  // Non-crypto fallback for insecure contexts (e.g. file:// in some browsers).
  // The once-a-day limit is a client-side convenience, not a security
  // control, so a plain deterministic hash is acceptable here.
  let h1 = 2166136261, h2 = 5381;
  for (let i = 0; i < msg.length; i++) {
    const c = msg.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (Math.imul(h2, 33) ^ c) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function todayStr() {
  return dateStrOf(new Date());
}

function summaryKey(schoolId, grade, date) {
  return `${schoolId}_${grade}_${date}`;
}

// ---------- Public API ----------

export async function joinSchool(joinCode, grade) {
  const { demo } = await ensureFirebase();
  if (demo) {
    demoSeedIfNeeded();
    const school = lsGet('school');
    if (!school || school.joinCode !== joinCode) {
      throw new Error('Invalid join code');
    }
    if (!school.enrolled[grade]) {
      throw new Error('Grade not available for this school');
    }
    return { schoolId: school.id, schoolName: school.name, grade };
  }

  try {
    const { db } = getFirebase();
    const { query, where, getDocs, collection } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const schoolsRef = collection(db, 'schools');
    const q = query(schoolsRef, where('joinCode', '==', joinCode));
    const snap = await getDocs(q);
    if (snap.empty) {
      // DEMO2026 is the reserved demo code: when Firebase is live
      // but no school uses it, fall back to the seeded demo school
      // so the demo works out of the box. Any other code is a
      // genuine "not found".
      if (joinCode === 'DEMO2026') {
        useDemoFallback();
        return joinSchool(joinCode, grade);
      }
      throw new Error('Invalid join code');
    }
    const schoolDoc = snap.docs[0];
    const school = schoolDoc.data();
    if (!school.enrolled[grade]) throw new Error('Grade not available for this school');
    return { schoolId: schoolDoc.id, schoolName: school.name, grade };
  } catch (err) {
    if (err.message === 'Invalid join code' || err.message === 'Grade not available for this school') {
      throw err;
    }
    useDemoFallback();
    return joinSchool(joinCode, grade);
  }
}

export async function checkAlreadyCheckedIn(schoolId, grade) {
  const { demo } = await ensureFirebase();
  const date = todayStr();

  let token = localStorage.getItem(LS_PREFIX + 'deviceToken');
  if (!token) {
    token = generateDeviceToken();
    localStorage.setItem(LS_PREFIX + 'deviceToken', token);
  }
  const hash = await hashToken(token, date);
  const limitKey = `${schoolId}_${grade}_${hash}`;

  if (demo) {
    demoSeedIfNeeded();
    const limits = lsGet('limits') || {};
    return !!limits[limitKey];
  }

  try {
    const { db } = getFirebase();
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'limits', limitKey));
    return snap.exists();
  } catch (err) {
    useDemoFallback();
    return checkAlreadyCheckedIn(schoolId, grade);
  }
}

export async function submitCheckIn(schoolId, grade, mood, tags) {
  const { demo } = await ensureFirebase();
  const date = todayStr();

  let token = localStorage.getItem(LS_PREFIX + 'deviceToken');
  if (!token) {
    token = generateDeviceToken();
    localStorage.setItem(LS_PREFIX + 'deviceToken', token);
  }
  const hash = await hashToken(token, date);
  const limitKey = `${schoolId}_${grade}_${hash}`;
  const summaryKeyStr = summaryKey(schoolId, grade, date);

  if (demo) {
    demoSeedIfNeeded();
    const limits = lsGet('limits') || {};
    if (limits[limitKey]) throw new Error('Already checked in today');
    limits[limitKey] = true;
    lsSet('limits', limits);

    const summaries = lsGet('summaries') || [];
    let summary = summaries.find((s) => s.schoolId === schoolId && s.grade === grade && s.date === date);
    if (!summary) {
      summary = {
        schoolId, grade, date, total: 0,
        moods: { sunny: 0, partly: 0, cloudy: 0, stormy: 0 },
        tags: { exams: 0, friends: 0, home: 0, sleep: 0, workload: 0, other: 0 }
      };
      summaries.push(summary);
    }
    summary.total += 1;
    summary.moods[mood] = (summary.moods[mood] || 0) + 1;
    for (const tag of tags) {
      summary.tags[tag] = (summary.tags[tag] || 0) + 1;
    }
    lsSet('summaries', summaries);
    return { success: true };
  }

  try {
    const { db } = getFirebase();
    const { doc, getDoc, setDoc, updateDoc, increment, writeBatch } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const batch = writeBatch(db);

    // Create the limit document (fails if it already exists).
    const limitRef = doc(db, 'limits', limitKey);
    batch.set(limitRef, { createdAt: new Date().toISOString() });

    // Increment the matching summary (create it first if missing).
    const summaryRef = doc(db, 'summaries', summaryKeyStr);
    const summarySnap = await getDoc(summaryRef);
    if (summarySnap.exists()) {
      const updates = { total: increment(1), [`moods.${mood}`]: increment(1) };
      for (const tag of tags) updates[`tags.${tag}`] = increment(1);
      batch.update(summaryRef, updates);
    } else {
      const initial = {
        total: 1,
        moods: { sunny: 0, partly: 0, cloudy: 0, stormy: 0 },
        tags: { exams: 0, friends: 0, home: 0, sleep: 0, workload: 0, other: 0 }
      };
      initial.moods[mood] = 1;
      for (const tag of tags) initial.tags[tag] = 1;
      batch.set(summaryRef, initial);
    }

    await batch.commit();
    return { success: true };
  } catch (err) {
    if (err.message === 'Already checked in today') throw err;
    useDemoFallback();
    return submitCheckIn(schoolId, grade, mood, tags);
  }
}

export async function getSummaries(schoolId, grades, days = 14) {
  const { demo } = await ensureFirebase();
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);

  const dateList = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dateList.push(d.toISOString().slice(0, 10));
  }

  if (demo) {
    demoSeedIfNeeded();
    const summaries = lsGet('summaries') || [];
    return summaries.filter((s) =>
      s.schoolId === schoolId &&
      grades.includes(s.grade) &&
      dateList.includes(s.date)
    );
  }

  try {
    const { db } = getFirebase();
    const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    // Single-field equality query (covered by the auto-created index);
    // grade and date are filtered in the browser.
    const q = query(collection(db, 'summaries'), where('schoolId', '==', schoolId));
    const snap = await getDocs(q);
    const first = dateList[0];
    const last = dateList[dateList.length - 1];
    return snap.docs
      .map((d) => d.data())
      .filter((s) => grades.includes(s.grade) && s.date >= first && s.date <= last);
  } catch (err) {
    useDemoFallback();
    return getSummaries(schoolId, grades, days);
  }
}

export async function getSchool(schoolId) {
  const { demo } = await ensureFirebase();
  if (demo) {
    demoSeedIfNeeded();
    return lsGet('school');
  }
  try {
    const { db } = getFirebase();
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'schools', schoolId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (err) {
    useDemoFallback();
    return getSchool(schoolId);
  }
}

export async function signInStaff(email, password) {
  const { demo, auth } = await ensureFirebase();
  if (demo) {
    demoSeedIfNeeded();
    const staff = lsGet('staff');
    const found = staff.find((s) => s.email === email);
    if (!found) throw new Error('Invalid credentials');
    const staffUser = { uid: found.uid, email: found.email, schoolId: found.schoolId, role: found.role };
    localStorage.setItem(LS_PREFIX + 'staffUser', JSON.stringify(staffUser));
    return staffUser;
  }

  try {
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const { db } = getFirebase();
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const staffSnap = await getDoc(doc(db, 'staff', cred.user.uid));
    if (!staffSnap.exists()) {
      await auth.signOut();
      throw new Error('Not authorized as staff');
    }
    return { uid: cred.user.uid, email: cred.user.email, ...staffSnap.data() };
  } catch (err) {
    if (err.message === 'Not authorized as staff' || err.message === 'Invalid credentials') {
      throw err;
    }
    useDemoFallback();
    return signInStaff(email, password);
  }
}

export async function signOutStaff() {
  const { demo, auth } = await ensureFirebase();
  if (demo) {
    lsRemove(LS_PREFIX + 'staffUser');
  } else {
    try {
      await auth.signOut();
    } catch { /* ignore */ }
  }
}

export async function getCurrentStaff() {
  const { demo, auth } = await ensureFirebase();
  if (demo) {
    demoSeedIfNeeded();
    return JSON.parse(localStorage.getItem(LS_PREFIX + 'staffUser') || 'null');
  }

  try {
    const user = auth.currentUser;
    if (!user) return null;
    const { db } = getFirebase();
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'staff', user.uid));
    return snap.exists() ? { uid: user.uid, ...snap.data() } : null;
  } catch (err) {
    useDemoFallback();
    return getCurrentStaff();
  }
}

export async function getHandledAlerts(schoolId) {
  const { demo } = await ensureFirebase();
  if (demo) {
    demoSeedIfNeeded();
    return lsGet('handled') || {};
  }
  try {
    const { db } = getFirebase();
    const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const handledRef = collection(db, 'handled');
    const q = query(handledRef, where('schoolId', '==', schoolId));
    const snap = await getDocs(q);
    const handled = {};
    snap.docs.forEach((d) => { handled[d.id] = d.data(); });
    return handled;
  } catch (err) {
    useDemoFallback();
    return getHandledAlerts(schoolId);
  }
}

export async function markAlertHandled(schoolId, grade, alertKey, handledBy) {
  const { demo } = await ensureFirebase();
  const id = `${schoolId}_${grade}_${alertKey}`;
  const data = { schoolId, grade, alertKey, handledBy, handledAt: new Date().toISOString() };
  if (demo) {
    demoSeedIfNeeded();
    const handled = lsGet('handled') || {};
    handled[id] = data;
    lsSet('handled', handled);
    return;
  }
  try {
    const { db } = getFirebase();
    const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    await setDoc(doc(db, 'handled', id), data);
  } catch (err) {
    useDemoFallback();
    return markAlertHandled(schoolId, grade, alertKey, handledBy);
  }
}

export async function unmarkAlertHandled(schoolId, grade, alertKey) {
  const { demo } = await ensureFirebase();
  const id = `${schoolId}_${grade}_${alertKey}`;
  if (demo) {
    demoSeedIfNeeded();
    const handled = lsGet('handled') || {};
    delete handled[id];
    lsSet('handled', handled);
    return;
  }
  try {
    const { db } = getFirebase();
    const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    await deleteDoc(doc(db, 'handled', id));
  } catch (err) {
    useDemoFallback();
    return unmarkAlertHandled(schoolId, grade, alertKey);
  }
}

// Re-export constants
export { MOODS, MOOD_ORDER, TAGS, SUPPORT_RESOURCES, dateStrOf } from './demo-data.js';
