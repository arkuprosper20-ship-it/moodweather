// MoodWeather student app
import { DEMO_MODE, isDemo, showDemoBanner } from './firebase.js';
import {
  joinSchool,
  checkAlreadyCheckedIn,
  submitCheckIn,
  MOODS,
  MOOD_ORDER,
  TAGS,
  SUPPORT_RESOURCES
} from './data.js';

const LS_TEXT = 'moodweather.largeText';
const LS_SESSION = 'moodweather.session';

window.__moodweatherBooted = true;

/* ---------- State ---------- */

const state = {
  schoolId: null,
  schoolName: null,
  grade: null,
  mood: null,
  tags: []
};

/* ---------- Helpers ---------- */

const $ = (id) => document.getElementById(id);

const screens = Array.from(document.querySelectorAll('.screen'));
const main = $('main');

function showScreen(id) {
  screens.forEach((s) => s.classList.toggle('active', s.id === 'screen-' + id));
  main.scrollTop = 0;
  const heading = document.querySelector('#screen-' + id + ' .screen-title');
  if (heading) heading.focus({ preventScroll: true });
}

function saveSession() {
  try {
    localStorage.setItem(LS_SESSION, JSON.stringify({
      schoolId: state.schoolId,
      schoolName: state.schoolName,
      grade: state.grade
    }));
  } catch { /* ignore */ }
}

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SESSION) || 'null');
    if (s && s.schoolId && s.grade) {
      state.schoolId = s.schoolId;
      state.schoolName = s.schoolName;
      state.grade = s.grade;
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

function resetFlow() {
  if (moodTimer) {
    window.clearTimeout(moodTimer);
    moodTimer = null;
  }
  state.mood = null;
  state.tags = [];
  moodCards.forEach((c) => {
    c.setAttribute('aria-checked', 'false');
    c.classList.remove('selected');
  });
  chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
  continueBtn.disabled = true;
}

/* ---------- Demo banner ---------- */

if (isDemo()) showDemoBanner();

/* ---------- Large text ---------- */

const textToggle = $('textToggle');

function applyTextPref(large) {
  document.documentElement.classList.toggle('large-text', large);
  textToggle.setAttribute('aria-pressed', large ? 'true' : 'false');
}

textToggle.addEventListener('click', () => {
  const large = textToggle.getAttribute('aria-pressed') !== 'true';
  applyTextPref(large);
  try { localStorage.setItem(LS_TEXT, large ? '1' : '0'); } catch { /* ignore */ }
});

try { applyTextPref(localStorage.getItem(LS_TEXT) === '1'); } catch { applyTextPref(false); }

/* ---------- Join ---------- */

const joinForm = $('joinForm');
const joinCodeInput = $('joinCode');
const gradeSelect = $('gradeSelect');
const joinError = $('joinError');
const joinSubmit = $('joinSubmit');

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  joinError.hidden = true;
  joinSubmit.disabled = true;

  const code = joinCodeInput.value.trim().toUpperCase();
  const grade = gradeSelect.value;

  if (!code) {
    joinError.textContent = 'Please enter your school join code.';
    joinError.hidden = false;
    joinSubmit.disabled = false;
    return;
  }
  if (!grade) {
    joinError.textContent = 'Please choose your grade.';
    joinError.hidden = false;
    joinSubmit.disabled = false;
    return;
  }

  try {
    const result = await joinSchool(code, grade);
    state.schoolId = result.schoolId;
    state.schoolName = result.schoolName;
    state.grade = result.grade;
    saveSession();
    resetFlow();
    showScreen('welcome');
  } catch (err) {
    joinError.textContent = err.message === 'Invalid join code'
      ? 'That join code doesn\'t match any school. Check it and try again.'
      : err.message === 'Grade not available for this school'
        ? 'That grade isn\'t available for this school. Ask a teacher.'
        : 'Something went wrong. Check your connection and try again.';
    joinError.hidden = false;
  } finally {
    joinSubmit.disabled = false;
  }
});

/* ---------- Welcome ---------- */

const dailyNote = $('dailyNote');
const startBtn = $('startBtn');

async function refreshDailyNote() {
  if (!state.schoolId) { dailyNote.hidden = true; return false; }
  try {
    const done = await checkAlreadyCheckedIn(state.schoolId, state.grade);
    dailyNote.hidden = !done;
    return done;
  } catch {
    dailyNote.hidden = true;
    return false;
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    const done = await refreshDailyNote();
    if (done) {
      showScreen('limit');
    } else {
      resetFlow();
      showScreen('mood');
    }
  } catch {
    showScreen('mood');
  } finally {
    startBtn.disabled = false;
  }
});

/* ---------- Mood ---------- */

const moodCards = Array.from(document.querySelectorAll('.mood-card'));
let moodTimer = null;

moodCards.forEach((card) => {
  card.addEventListener('click', () => selectMood(card));
  card.addEventListener('keydown', (event) => {
    const dirs = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const dir = dirs[event.key];
    if (!dir) return;
    event.preventDefault();
    const i = moodCards.indexOf(card);
    moodCards[(i + dir + moodCards.length) % moodCards.length].focus();
  });
});

function selectMood(card) {
  if (state.mood) return;
  state.mood = card.getAttribute('data-mood');
  moodCards.forEach((c) => {
    const on = c === card;
    c.setAttribute('aria-checked', on ? 'true' : 'false');
    c.classList.toggle('selected', on);
  });
  moodTimer = window.setTimeout(() => showScreen('tags'), 500);
}

/* ---------- Tags ---------- */

const continueBtn = $('continueBtn');
const chips = Array.from(document.querySelectorAll('.chip'));

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const on = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', on ? 'false' : 'true');
    const tag = chip.getAttribute('data-tag');
    if (on) {
      state.tags = state.tags.filter((t) => t !== tag);
    } else {
      state.tags.push(tag);
    }
    continueBtn.disabled = state.tags.length === 0;
  });
});

continueBtn.addEventListener('click', finish);
$('skipBtn').addEventListener('click', finish);

async function finish() {
  if (!state.mood) return;
  continueBtn.disabled = true;
  $('skipBtn').disabled = true;

  try {
    await submitCheckIn(state.schoolId, state.grade, state.mood, state.tags);
    renderThanks();
    showScreen('thanks');
  } catch (err) {
    if (err.message === 'Already checked in today') {
      showScreen('limit');
    } else {
      alert('Could not save your check-in. Check your connection and try again.');
      showScreen('mood');
    }
  } finally {
    continueBtn.disabled = true;
    $('skipBtn').disabled = false;
  }
}

/* ---------- Thank-you ---------- */

const thanksIcon = $('thanksIcon');
const thanksMood = $('thanksMood');
const thanksMessage = $('thanksMessage');
const thanksTags = $('thanksTags');
const supportCard = $('supportCard');

const MESSAGES = {
  sunny: "Glad your sky is bright today. Hold on to a little of that calm — you've earned it.",
  partly: "Okay is a perfectly good place to be. If the clouds drift in later, that's alright too.",
  cloudy: "Cloudy days are heavy, and you showed up anyway. Go gently today — small things count.",
  stormy: "Storms feel overwhelming, but they do pass. You don't have to weather this alone."
};

function renderThanks() {
  const mood = state.mood;
  const data = MOODS[mood];
  const card = document.querySelector('.mood-card[data-mood="' + mood + '"]');

  thanksIcon.innerHTML = '';
  if (card) {
    const svg = card.querySelector('svg').cloneNode(true);
    svg.removeAttribute('class');
    thanksIcon.appendChild(svg);
  }

  thanksMood.textContent = 'Your sky today: ' + data.label;
  thanksMessage.textContent = MESSAGES[mood];

  if (state.tags.length) {
    const labels = state.tags.map((t) => {
      const found = TAGS.find((x) => x.id === t);
      return found ? found.label : t;
    });
    thanksTags.hidden = false;
    thanksTags.textContent = 'Behind it: ' + labels.join(' · ');
  } else {
    thanksTags.hidden = true;
  }

  supportCard.hidden = !(mood === 'cloudy' || mood === 'stormy');
}

$('doneBtn').addEventListener('click', () => {
  resetFlow();
  refreshDailyNote();
  showScreen('welcome');
});

$('homeBtn').addEventListener('click', () => showScreen('welcome'));

/* ---------- Navigation ---------- */

let privacyFrom = 'welcome';
let howFrom = 'welcome';

function openPrivacy(from) {
  privacyFrom = from;
  showScreen('privacy');
}

function openHow(from) {
  howFrom = from;
  showScreen('how');
}

$('privacyLink').addEventListener('click', () => openPrivacy('welcome'));
$('privacyLink2').addEventListener('click', () => openPrivacy('thanks'));
$('privacyLink3').addEventListener('click', () => openPrivacy('limit'));
$('joinPrivacyLink').addEventListener('click', () => openPrivacy('join'));

$('privacyBack').addEventListener('click', () => showScreen(privacyFrom));
$('howBack').addEventListener('click', () => showScreen(howFrom));

$('brandLink').addEventListener('click', (event) => {
  event.preventDefault();
  resetFlow();
  if (state.schoolId) {
    showScreen('welcome');
  } else {
    showScreen('join');
  }
});

/* ---------- Init ---------- */

(async function init() {
  const hasSession = loadSession();
  if (hasSession) {
    await refreshDailyNote();
    showScreen('welcome');
  } else {
    showScreen('join');
  }
})();
