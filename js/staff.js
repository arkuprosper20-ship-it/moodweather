// MoodWeather staff dashboard
import { DEMO_MODE, isDemo, showDemoBanner } from './firebase.js';
import {
  signInStaff,
  signOutStaff,
  getCurrentStaff,
  getSchool,
  getSummaries,
  getHandledAlerts,
  markAlertHandled,
  unmarkAlertHandled,
  MOODS,
  MOOD_ORDER,
  TAGS,
  MIN_GROUP_SIZE,
  dateStrOf
} from './data.js';

/* ---------- Constants ---------- */

const GRADES = ['7', '8', '9', '10', '11', '12'];
const DAYS = 14;
const ALERT_STRESS_THRESHOLD = 20; // percentage points
const ALERT_MIN_RESPONSES = 10;
const ALERT_LOW_PARTICIPATION = 30; // percent

/* ---------- State ---------- */

const state = {
  staff: null,
  school: null,
  summaries: [],
  handled: {},
  selectedGrade: '11',
  alerts: []
};

/* ---------- Helpers ---------- */

const $ = (id) => document.getElementById(id);

function dateStrLocal(d) {
  return dateStrOf(d);
}

function lastNDays(n) {
  const dates = [];
  const end = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    dates.push(dateStrLocal(d));
  }
  return dates;
}

function splitWeeks(dates) {
  const mid = Math.floor(dates.length / 2);
  return { thisWeek: dates.slice(mid), lastWeek: dates.slice(0, mid) };
}

function sumBy(arr, key) {
  return arr.reduce((acc, item) => acc + (item[key] || 0), 0);
}

function moodShare(summaries, mood) {
  const total = sumBy(summaries, 'total');
  if (!total) return 0;
  const count = summaries.reduce((acc, s) => acc + (s.moods?.[mood] || 0), 0);
  return Math.round((count / total) * 100);
}

function tagShare(summaries, tag) {
  const total = sumBy(summaries, 'total');
  if (!total) return 0;
  const count = summaries.reduce((acc, s) => acc + (s.tags?.[tag] || 0), 0);
  return Math.round((count / total) * 100);
}

// Participation rate = average DAILY participation over the period.
// (A student can check in once per day, so summing a week's counters
// and dividing by enrolled would exceed 100%.)
function participationRate(summaries, enrolled) {
  if (!enrolled || !summaries.length) return 0;
  const total = sumBy(summaries, 'total');
  const days = new Set(summaries.map((s) => s.date)).size || 1;
  return Math.round((total / days / enrolled) * 100);
}

// Average check-ins per day in the period.
function perDay(summaries) {
  if (!summaries.length) return 0;
  const days = new Set(summaries.map((s) => s.date)).size || 1;
  return Math.round(sumBy(summaries, 'total') / days);
}

function dominantMood(summaries) {
  let best = 'sunny';
  let bestShare = -1;
  for (const m of MOOD_ORDER) {
    const share = moodShare(summaries, m);
    if (share > bestShare) {
      bestShare = share;
      best = m;
    }
  }
  return best;
}

function topReason(summaries) {
  let best = null;
  let bestShare = -1;
  for (const t of TAGS) {
    const share = tagShare(summaries, t.id);
    if (share > bestShare) {
      bestShare = share;
      best = t;
    }
  }
  return best;
}

function trendPill(pts, suffix) {
  const cls = pts > 0 ? 'trend trend-up' : (pts < 0 ? 'trend trend-down' : 'trend trend-flat');
  const arrow = pts > 0 ? '\u25B2' : (pts < 0 ? '\u25BC' : '\u25AC');
  const label = suffix || 'vs last week';
  return `<span class="${cls}">${arrow} ${Math.abs(pts)} pts <span class="sr-only">participation ${label}</span></span>`;
}

function moodIcon(mood) {
  const icons = {
    sunny: '<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><g stroke="#F59E0B" stroke-width="6" stroke-linecap="round"><line x1="48" y1="6" x2="48" y2="18"/><line x1="48" y1="78" x2="48" y2="90"/><line x1="6" y1="48" x2="18" y2="48"/><line x1="78" y1="48" x2="90" y2="48"/><line x1="18" y1="18" x2="27" y2="27"/><line x1="69" y1="69" x2="78" y2="78"/><line x1="78" y1="18" x2="69" y2="27"/><line x1="27" y1="69" x2="18" y2="78"/></g><circle cx="48" cy="48" r="20" fill="#FBBF24"/><circle cx="48" cy="48" r="12" fill="#FDE68A"/></svg>',
    partly: '<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><g stroke="#F59E0B" stroke-width="5" stroke-linecap="round"><line x1="20" y1="6" x2="20" y2="15"/><line x1="8" y1="18" x2="15" y2="25"/><line x1="32" y1="18" x2="25" y2="25"/><line x1="6" y1="34" x2="15" y2="34"/></g><circle cx="20" cy="34" r="13" fill="#FBBF24"/><g fill="#93C5FD"><circle cx="52" cy="52" r="14"/><circle cx="70" cy="46" r="18"/><circle cx="84" cy="55" r="12"/><rect x="42" y="54" width="48" height="16" rx="8"/></g></svg>',
    cloudy: '<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><g fill="#8698AD"><circle cx="34" cy="46" r="14"/><circle cx="52" cy="40" r="19"/><circle cx="70" cy="48" r="14"/><rect x="22" y="48" width="58" height="19" rx="9.5"/></g></svg>',
    stormy: '<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><g fill="#64748B"><circle cx="34" cy="40" r="14"/><circle cx="52" cy="34" r="19"/><circle cx="70" cy="42" r="14"/><rect x="22" y="42" width="58" height="19" rx="9.5"/></g><path d="M46 58 L34 80 h10 l-4 14 18-22 h-10 l6 -14 Z" fill="#F59E0B"/></svg>'
  };
  return icons[mood] || icons.sunny;
}

/* ---------- Sign-in ---------- */

const signinForm = $('signinForm');
const signinError = $('signinError');
const signinSubmit = $('signinSubmit');

signinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  signinError.hidden = true;
  signinSubmit.disabled = true;

  const email = $('signinEmail').value.trim();
  const password = $('signinPassword').value;

  if (!email || !password) {
    signinError.textContent = 'Please enter your email and password.';
    signinError.hidden = false;
    signinSubmit.disabled = false;
    return;
  }

  try {
    const user = await signInStaff(email, password);
    state.staff = user;
    await loadDashboard();
  } catch (err) {
    signinError.textContent = err.message === 'Not authorized as staff'
      ? 'Your account is not authorized to view this dashboard.'
      : 'Invalid email or password. Try again.';
    signinError.hidden = false;
  } finally {
    signinSubmit.disabled = false;
  }
});

$('signOutBtn').addEventListener('click', async () => {
  await signOutStaff();
  state.staff = null;
  state.school = null;
  state.summaries = [];
  state.handled = {};
  $('dashboard').hidden = true;
  $('signin-app').hidden = false;
});

/* ---------- Dashboard load ---------- */

async function loadDashboard() {
  const staff = state.staff;
  const school = await getSchool(staff.schoolId);
  state.school = school;

  const summaries = await getSummaries(staff.schoolId, [...GRADES, '12b'], DAYS);
  state.summaries = summaries;

  state.handled = await getHandledAlerts(staff.schoolId);

  $('sidebarSchool').textContent = school ? school.name : 'School';
  $('weekChip').textContent = 'Week of ' + lastNDays(7)[0] + ' – ' + lastNDays(7)[6];
  $('demoChip').hidden = !isDemo();

  if (isDemo()) showDemoBanner();

  $('signin-app').hidden = true;
  $('dashboard').hidden = false;

  computeAlerts();
  renderOverview();
  renderGradePills();
  renderGradeBody();
  renderAlerts();
  showScreen('overview');
}

/* ---------- Screen navigation ---------- */

const SCREENS = {
  overview: { title: 'School overview', sub: 'Group patterns for the latest complete week — never individual students.' },
  grade: { title: 'Grade detail', sub: 'Seven-day trends, top reasons, and participation for one grade.' },
  alerts: { title: 'Alerts', sub: 'Patterns worth a look, with a suggested next step.' },
  guidance: { title: 'How to use this data', sub: 'Four rules before you act on anything you see here.' }
};

const navItems = Array.from(document.querySelectorAll('.nav-item'));
const main = $('staff-main');
const pageTitle = $('pageTitle');
const pageSub = $('pageSub');

function showScreen(name) {
  if (!SCREENS[name]) name = 'overview';

  Array.from(document.querySelectorAll('#staff-main .screen')).forEach((s) => {
    s.classList.toggle('active', s.id === 'screen-' + name);
  });

  navItems.forEach((item) => {
    if (item.getAttribute('data-screen') === name) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });

  pageTitle.textContent = SCREENS[name].title;
  pageSub.textContent = SCREENS[name].sub;
  document.title = 'MoodWeather for Staff — ' + SCREENS[name].title;
  main.scrollTop = 0;
  pageTitle.focus({ preventScroll: true });
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    showScreen(item.getAttribute('data-screen'));
  });
});

// Cards or buttons marked [data-goto] switch dashboard screens
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-goto]');
  if (target) showScreen(target.getAttribute('data-goto'));
});

/* ---------- Overview ---------- */

function renderOverview() {
  const school = state.school;
  const summaries = state.summaries;
  const dates = lastNDays(DAYS);
  const { thisWeek, lastWeek } = splitWeeks(dates);

  const inWeek = (list, week) => list.filter((s) => week.includes(s.date) && GRADES.includes(s.grade));
  const thisWeekSummaries = inWeek(summaries, thisWeek);
  const lastWeekSummaries = inWeek(summaries, lastWeek);

  const totalStudents = GRADES.reduce((acc, g) => acc + (school?.enrolled?.[g] || 0), 0);
  const totalChecked = sumBy(thisWeekSummaries, 'total');
  const schoolPct = participationRate(thisWeekSummaries, totalStudents);
  const lastWeekPct = participationRate(lastWeekSummaries, totalStudents);

  const openAlerts = state.alerts.filter((a) => !state.handled[`${state.staff.schoolId}_${a.grade}_${a.key}`]).length;

  const allGroups = [...GRADES, '12b'];
  const visibleGroups = allGroups.filter((g) => {
    const weekTotal = sumBy(summaries.filter((s) => s.grade === g && thisWeek.includes(s.date)), 'total');
    return weekTotal >= MIN_GROUP_SIZE;
  }).length;

  $('statGrid').innerHTML =
    statCard('School participation', schoolPct + '%', trendPill(schoolPct - lastWeekPct) + '<span>vs last week</span>') +
    statCard('Check-ins this week', totalChecked, `<span>${totalStudents} students enrolled</span>`) +
    statCard('Grades shown', visibleGroups + ' of ' + allGroups.length, `<span>${allGroups.length - visibleGroups} hidden (&lt; 5 responses)</span>`) +
    `<button type="button" class="card stat-card stat-link" data-goto="alerts">
       <p class="stat-label">Open alerts</p>
       <p class="stat-value" id="openAlertsStat">${openAlerts}</p>
       <p class="stat-meta"><span>Patterns to review</span></p>
     </button>`;

  $('mapGrid').innerHTML = GRADES.map((grade) => tileHtml(grade, thisWeekSummaries, lastWeekSummaries, school)).join('') +
    hiddenTileHtml('12b');
}

function statCard(label, value, meta) {
  return `<article class="card stat-card">
    <p class="stat-label">${label}</p>
    <p class="stat-value">${value}</p>
    <p class="stat-meta">${meta}</p>
  </article>`;
}

function tileHtml(grade, thisWeekSummaries, lastWeekSummaries, school) {
  const gradeSummaries = thisWeekSummaries.filter((s) => s.grade === grade);
  const lastGradeSummaries = lastWeekSummaries.filter((s) => s.grade === grade);
  const total = sumBy(gradeSummaries, 'total');
  const enrolled = school?.enrolled?.[grade] || 0;
  const pct = participationRate(gradeSummaries, enrolled);
  const lastPct = participationRate(lastGradeSummaries, enrolled);
  const pts = pct - lastPct;

  if (total < MIN_GROUP_SIZE) {
    return hiddenTileHtml(grade);
  }

  const dom = dominantMood(gradeSummaries);
  const second = MOOD_ORDER.slice().sort((a, b) => moodShare(gradeSummaries, b) - moodShare(gradeSummaries, a))[1];
  const avg = perDay(gradeSummaries);

  return `<article class="card tile">
    <header class="tile-head">
      <h3>Grade ${grade}</h3>
      ${trendPill(pts)}
    </header>
    <div class="tile-body">
      <span class="tile-icon">${moodIcon(dom)}</span>
      <div>
        <p class="tile-mood">${MOODS[dom].label}</p>
        <p class="tile-sub">${MOODS[dom].label} ${moodShare(gradeSummaries, dom)}% · ${MOODS[second].label} ${moodShare(gradeSummaries, second)}%</p>
      </div>
    </div>
    <div class="tile-part">
      <div class="bar" role="progressbar" aria-label="Grade ${grade} participation" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <span class="bar-fill" style="width: ${pct}%"></span>
      </div>
      <p class="tile-part-text"><strong>${pct}%</strong> checked in · avg ${avg} of ${enrolled} students per day</p>
    </div>
  </article>`;
}

function hiddenTileHtml(grade) {
  const label = grade === '12b' ? 'Grade 12 · Class B' : `Grade ${grade}`;
  return `<article class="card tile tile-hidden">
    <header class="tile-head"><h3>${label}</h3></header>
    <div class="privacy-state">
      <span class="privacy-icon">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <rect x="12" y="20" width="24" height="20" rx="6"/>
          <path d="M17 20v-5a7 7 0 0 1 14 0v5"/>
          <circle cx="24" cy="30" r="2.5" fill="currentColor"/>
        </svg>
      </span>
      <p class="privacy-title">Not enough responses to display</p>
      <p class="privacy-sub">Groups with fewer than ${MIN_GROUP_SIZE} responses are hidden to protect privacy.</p>
    </div>
  </article>`;
}

/* ---------- Grade detail ---------- */

function renderGradePills() {
  $('gradePills').innerHTML = GRADES.map((grade) => {
    const pressed = grade === state.selectedGrade;
    return `<button type="button" class="grade-pill" data-grade="${grade}" aria-pressed="${pressed}">Grade ${grade}</button>`;
  }).join('') +
  `<button type="button" class="grade-pill" data-grade="12b" aria-pressed="${state.selectedGrade === '12b'}">
     <span class="pill-lock" aria-hidden="true">
       <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" focusable="false" style="width:100%;height:100%">
         <rect x="12" y="20" width="24" height="20" rx="6"/>
         <path d="M17 20v-5a7 7 0 0 1 14 0v5"/>
         <circle cx="24" cy="30" r="2.5" fill="currentColor"/>
       </svg>
     </span>
     Grade 12 · Class B
   </button>`;

  Array.from($('gradePills').querySelectorAll('.grade-pill')).forEach((pill) => {
    pill.addEventListener('click', () => {
      state.selectedGrade = pill.getAttribute('data-grade');
      Array.from($('gradePills').querySelectorAll('.grade-pill')).forEach((p) => {
        p.setAttribute('aria-pressed', p === pill ? 'true' : 'false');
      });
      renderGradeBody();
    });
  });
}

function renderGradeBody() {
  const grade = state.selectedGrade;
  const school = state.school;
  const summaries = state.summaries;
  const dates = lastNDays(DAYS);
  const { thisWeek } = splitWeeks(dates);

  const gradeSummaries = summaries.filter((s) => s.grade === grade && thisWeek.includes(s.date));
  const total = sumBy(gradeSummaries, 'total');
  const enrolled = grade === '12b' ? 31 : (school?.enrolled?.[grade] || 0);

  if (total < MIN_GROUP_SIZE) {
    $('gradeBody').innerHTML = `
      <div class="card grade-head">
        <div>
          <h2>${grade === '12b' ? 'Grade 12 · Class B' : 'Grade ' + grade}</h2>
          <p class="muted">Week of ${thisWeek[0]} – ${thisWeek[thisWeek.length - 1]}</p>
        </div>
      </div>
      <div class="card privacy-panel">
        <span class="privacy-icon">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <rect x="12" y="20" width="24" height="20" rx="6"/>
            <path d="M17 20v-5a7 7 0 0 1 14 0v5"/>
            <circle cx="24" cy="30" r="2.5" fill="currentColor"/>
          </svg>
        </span>
        <h2>Not enough responses to display</h2>
        <p>This group has fewer than ${MIN_GROUP_SIZE} responses this week. Groups this small are hidden so no one can be identified.</p>
      </div>`;
    return;
  }

  const pct = participationRate(gradeSummaries, enrolled);
  const avg = perDay(gradeSummaries);
  const dom = dominantMood(gradeSummaries);

  const moodStats = MOOD_ORDER.map((m) => {
    return `<span class="mood-stat">${moodIcon(m)} ${MOODS[m].label} <strong>${moodShare(gradeSummaries, m)}%</strong></span>`;
  }).join('');

  $('gradeBody').innerHTML = `
    <div class="card grade-head">
      <div>
        <h2>${grade === '12b' ? 'Grade 12 · Class B' : 'Grade ' + grade}</h2>
        <p class="muted">Week of ${thisWeek[0]} – ${thisWeek[thisWeek.length - 1]} · compared with previous week</p>
        <div class="mood-stats">${moodStats}</div>
      </div>
      <div class="part-block">
        <p class="part-value">${pct}%</p>
        <p class="part-label">participation</p>
        <p class="stat-meta"><span>avg ${avg} of ${enrolled} students per day</span></p>
      </div>
    </div>

    <div class="card chart-card">
      <div class="chart-head">
        <h2>7-day mood trend</h2>
        <div class="legend">
          ${MOOD_ORDER.map((m) => `<span class="legend-item">${moodIcon(m)} ${MOODS[m].label}</span>`).join('')}
        </div>
      </div>
      <div class="chart-wrap">${buildChart(gradeSummaries, grade)}</div>
      ${buildDataTable(gradeSummaries, grade)}
    </div>

    <div class="card reasons-card">
      <h2>Top reasons this week</h2>
      <p class="muted">Share of tagged check-ins in ${grade === '12b' ? 'Grade 12 · Class B' : 'Grade ' + grade}</p>
      ${TAGS.map((t) => {
        const share = tagShare(gradeSummaries, t.id);
        return `<div class="reason-row">
          <span class="reason-label">${t.label}</span>
          <div class="reason-bar" role="img" aria-label="${t.label}: ${share}% of tags">
            <span class="reason-fill" style="width: ${share}%"></span>
          </div>
          <span class="reason-value">${share}%</span>
        </div>`;
      }).join('')}
      <p class="reason-note">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M24 6l4 10 10 4-10 4-4 10-4-10-10-4 10-4z"/>
        </svg>
        ${topReason(gradeSummaries)?.label || 'No tags'} is the most common reason this week.
      </p>
    </div>

    <p class="muted" style="font-size: 0.85rem; margin: 0;">
      Most common mood this week: ${MOODS[dom].label} (${moodShare(gradeSummaries, dom)}%).
      Groups with fewer than ${MIN_GROUP_SIZE} responses are hidden to protect privacy.
    </p>`;
}

function buildChart(gradeSummaries, grade) {
  const dates = lastNDays(7);
  const byDate = {};
  dates.forEach((d) => {
    const s = gradeSummaries.find((x) => x.date === d);
    byDate[d] = s || { total: 0, moods: { sunny: 0, partly: 0, cloudy: 0, stormy: 0 } };
  });

  const W = 760, H = 300, padL = 52, padR = 18, padT = 16, padB = 44;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const step = plotW / 6;

  // Scale the Y axis to the data (never less than 50%) so high shares
  // (e.g. a mostly-sunny grade) are not clipped.
  let maxShare = 0;
  dates.forEach((d) => {
    const s = byDate[d];
    if (!s.total) return;
    MOOD_ORDER.forEach((m) => {
      maxShare = Math.max(maxShare, Math.round((s.moods[m] / s.total) * 100));
    });
  });
  const maxV = Math.max(50, Math.ceil(maxShare / 10) * 10);

  const x = (i) => padL + i * step;
  const y = (v) => padT + plotH * (1 - v / maxV);

  const parts = [];

  // Weekend bands on the actual Sat/Sun days of the week shown
  let firstWeekend = -1;
  dates.forEach((d, i) => {
    const dow = new Date(d + 'T12:00:00').getDay();
    if (dow === 0 || dow === 6) {
      const bx = Math.max(padL, x(i) - step / 2);
      const bw = Math.min(W - padR, x(i) + step / 2) - bx;
      parts.push(`<rect x="${bx}" y="${padT}" width="${bw}" height="${plotH}" fill="#ede9fe" opacity="0.65"/>`);
      if (firstWeekend < 0) firstWeekend = i;
    }
  });
  if (firstWeekend >= 0) {
    parts.push(`<text x="${x(firstWeekend)}" y="${padT + 14}" text-anchor="middle" class="chart-note">weekend</text>`);
  }

  // Gridlines
  for (let v = 0; v <= maxV; v += 10) {
    parts.push(`<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="${v === 0 ? '#cbd5e1' : '#e5e7eb'}" stroke-width="1"/>`);
    parts.push(`<text x="${padL - 10}" y="${y(v) + 4}" text-anchor="end" class="chart-axis">${v}%</text>`);
  }

  // X labels
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dates.forEach((d, i) => {
    const dayName = dayNames[new Date(d + 'T12:00:00').getDay()];
    parts.push(`<text x="${x(i)}" y="${H - 14}" text-anchor="middle" class="chart-axis">${dayName}</text>`);
  });

  // Lines
  MOOD_ORDER.forEach((m) => {
    const pts = dates.map((d, i) => {
      const s = byDate[d];
      const share = s.total ? Math.round((s.moods[m] / s.total) * 100) : 0;
      return `${x(i)},${y(share)}`;
    }).join(' ');
    parts.push(`<polyline points="${pts}" fill="none" stroke="${MOODS[m].line || '#4338CA'}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
    dates.forEach((d, i) => {
      const s = byDate[d];
      const share = s.total ? Math.round((s.moods[m] / s.total) * 100) : 0;
      parts.push(`<circle cx="${x(i)}" cy="${y(share)}" r="4" fill="#ffffff" stroke="${MOODS[m].line || '#4338CA'}" stroke-width="2.5"><title>${dayNames[new Date(d + 'T12:00:00').getDay()]} · ${MOODS[m].label}: ${share}%</title></circle>`);
    });
  });

  const summary = `Line chart of daily mood share for Grade ${grade}, last 7 days. ` +
    MOOD_ORDER.map((m) => {
      const first = byDate[dates[0]];
      const last = byDate[dates[dates.length - 1]];
      const firstShare = first.total ? Math.round((first.moods[m] / first.total) * 100) : 0;
      const lastShare = last.total ? Math.round((last.moods[m] / last.total) * 100) : 0;
      return `${MOODS[m].label}: ${firstShare}% to ${lastShare}%`;
    }).join('; ') + '. Full data in the table below.';

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${summary}">${parts.join('')}</svg>`;
}

function buildDataTable(gradeSummaries, grade) {
  const dates = lastNDays(7);
  const rows = dates.map((d) => {
    const s = gradeSummaries.find((x) => x.date === d) || { total: 0, moods: { sunny: 0, partly: 0, cloudy: 0, stormy: 0 } };
    const share = (m) => s.total ? Math.round((s.moods[m] / s.total) * 100) : 0;
    return `<tr><td>${d}</td><td>${share('sunny')}%</td><td>${share('partly')}%</td><td>${share('cloudy')}%</td><td>${share('stormy')}%</td><td>${s.total}</td></tr>`;
  }).join('');

  return `<details class="data-table">
    <summary>View data as table</summary>
    <table>
      <caption>Daily mood share and total check-ins — Grade ${grade}</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Sunny</th><th scope="col">Partly cloudy</th><th scope="col">Cloudy</th><th scope="col">Stormy</th><th scope="col">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

/* ---------- Alerts ---------- */

function computeAlerts() {
  const school = state.school;
  const summaries = state.summaries;
  const dates = lastNDays(DAYS);
  const { thisWeek, lastWeek } = splitWeeks(dates);

  const alerts = [];

  for (const grade of GRADES) {
    const thisWeekSummaries = summaries.filter((s) => s.grade === grade && thisWeek.includes(s.date));
    const lastWeekSummaries = summaries.filter((s) => s.grade === grade && lastWeek.includes(s.date));

    const total = sumBy(thisWeekSummaries, 'total');
    if (total < ALERT_MIN_RESPONSES) continue;

    const enrolled = school?.enrolled?.[grade] || 0;

    // Rule 1: stress rose 20+ percentage points
    const stressThis = moodShare(thisWeekSummaries, 'cloudy') + moodShare(thisWeekSummaries, 'stormy');
    const stressLast = moodShare(lastWeekSummaries, 'cloudy') + moodShare(lastWeekSummaries, 'stormy');
    const stressDelta = stressThis - stressLast;

    if (stressDelta >= ALERT_STRESS_THRESHOLD) {
      const reason = topReason(thisWeekSummaries);
      alerts.push({
        key: 'stress_' + grade,
        grade,
        severity: 'high',
        icon: 'alert',
        pattern: `Grade ${grade} stress is up ${stressDelta} points this week`,
        detail: `${stressThis}% of check-ins were Cloudy or Stormy, up from ${stressLast}% last week. ${reason ? reason.label + ' is the main reason (' + tagShare(thisWeekSummaries, reason.id) + '% of tags).' : ''}`,
        responses: ['Run a 10-minute class check-in', 'Flag to the school counselor']
      });
    }

    // Rule 2: low participation (average daily participation below 30%)
    const pct = participationRate(thisWeekSummaries, enrolled);

    if (pct < ALERT_LOW_PARTICIPATION) {
      const avg = perDay(thisWeekSummaries);
      alerts.push({
        key: 'participation_' + grade,
        grade,
        severity: 'medium',
        icon: 'trendUp',
        pattern: `Grade ${grade} participation is only ${pct}%`,
        detail: `On average only ${avg} of ${enrolled} students checked in per day this week. Fewer students are sharing how they feel, so the picture is less complete.`,
        responses: ['Send a check-in reminder to Grade ' + grade + ' tutors', 'Flag to the school counselor']
      });
    }
  }

  // Rule 3: fast-rising reason (watch level)
  for (const grade of GRADES) {
    const thisWeekSummaries = summaries.filter((s) => s.grade === grade && thisWeek.includes(s.date));
    const lastWeekSummaries = summaries.filter((s) => s.grade === grade && lastWeek.includes(s.date));
    const total = sumBy(thisWeekSummaries, 'total');
    if (total < ALERT_MIN_RESPONSES) continue;

    for (const t of TAGS) {
      const thisShare = tagShare(thisWeekSummaries, t.id);
      const lastShare = tagShare(lastWeekSummaries, t.id);
      if (thisShare >= 25 && thisShare - lastShare >= 10) {
        alerts.push({
          key: 'reason_' + grade + '_' + t.id,
          grade,
          severity: 'watch',
          icon: 'spark',
          pattern: `${t.label} is rising fast in Grade ${grade}`,
          detail: `Up from ${lastShare}% last week to ${thisShare}% this week. Worth watching, not acting on alone.`,
          responses: ['Share tips at assembly', 'Flag to the school counselor']
        });
        break;
      }
    }
  }

  state.alerts = alerts;
}

function refreshAlertCounts() {
  const schoolId = state.staff.schoolId;
  const openCount = state.alerts.filter((a) => !state.handled[`${schoolId}_${a.grade}_${a.key}`]).length;
  $('alertBadge').textContent = openCount;
  const statEl = $('openAlertsStat');
  if (statEl) statEl.textContent = openCount;
  return openCount;
}

function renderAlerts() {
  computeAlerts();

  const schoolId = state.staff.schoolId;
  const openCount = refreshAlertCounts();

  $('alertsNoticeSub').textContent = openCount
    ? `${openCount} open alert${openCount === 1 ? '' : 's'} for this school.`
    : 'No open alerts right now.';

  $('alertList').innerHTML = state.alerts.map((a) => alertHtml(a)).join('') ||
    '<p class="muted" style="text-align:center; padding:2rem;">No alerts match the current rules. Check back after more check-ins.</p>';

  Array.from($('alertList').querySelectorAll('.btn-handle')).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const alert = state.alerts.find((x) => `${x.grade}_${x.key}` === id);
      if (!alert) return;
      const key = `${schoolId}_${alert.grade}_${alert.key}`;
      await markAlertHandled(schoolId, alert.grade, alert.key, state.staff.uid);
      state.handled[key] = {
        schoolId, grade: alert.grade, alertKey: alert.key,
        handledBy: state.staff.uid, handledAt: new Date().toISOString()
      };
      renderAlerts();
    });
  });

  Array.from($('alertList').querySelectorAll('.undo-link')).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const alert = state.alerts.find((x) => `${x.grade}_${x.key}` === id);
      if (!alert) return;
      const key = `${schoolId}_${alert.grade}_${alert.key}`;
      await unmarkAlertHandled(schoolId, alert.grade, alert.key);
      delete state.handled[key];
      renderAlerts();
    });
  });
}

function alertHtml(a) {
  const schoolId = state.staff.schoolId;
  const id = `${a.grade}_${a.key}`;
  const isHandled = !!state.handled[`${schoolId}_${id}`];
  const sevLabel = a.severity === 'high' ? 'High priority' : (a.severity === 'medium' ? 'Medium priority' : 'Keep an eye on');

  const icons = {
    alert: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M24 8l19 33H5z"/><line x1="24" y1="20" x2="24" y2="29"/><circle cx="24" cy="35" r="1.6" fill="currentColor"/></svg>',
    trendUp: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6,36 18,24 26,30 42,12"/><polyline points="32,12 42,12 42,22"/></svg>',
    spark: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M24 6l4 10 10 4-10 4-4 10-4-10-10-4 10-4z"/></svg>',
    check: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="9,25 20,36 39,14"/></svg>'
  };

  return `<article class="card alert${isHandled ? ' handled' : ''}" data-id="${id}">
    <span class="alert-icon sev-${a.severity}">${icons[a.icon] || icons.alert}</span>
    <div class="alert-main">
      <div class="alert-head">
        <h3>${a.pattern}</h3>
        <span class="sev-chip sev-${a.severity}">${sevLabel}</span>
      </div>
      <p class="alert-detail">${a.detail}</p>
      <div class="suggested">
        <span class="suggested-label">Suggested response</span>
        ${a.responses.map((r) => `<span class="sugg-chip">${icons.check} ${r}</span>`).join('')}
      </div>
    </div>
    <div class="alert-actions">
      ${isHandled
        ? `<span class="handled-badge">${icons.check}Handled</span><button type="button" class="undo-link" data-id="${id}">Undo</button>`
        : `<button type="button" class="btn-handle" data-id="${id}">Mark as handled</button>`}
    </div>
  </article>`;
}

/* ---------- Init ---------- */

(async function init() {
  window.__moodweatherBooted = true;
  const staff = await getCurrentStaff();
  if (staff) {
    state.staff = staff;
    await loadDashboard();
  } else {
    $('signin-app').hidden = false;
    $('dashboard').hidden = true;
    if (isDemo()) {
      showDemoBanner();
      $('demoHint').hidden = false;
    }
  }
})();
