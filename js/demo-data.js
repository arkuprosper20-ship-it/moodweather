// MoodWeather demo data — one school, ~460 students, 14 days of realistic counters
// Dates are generated relative to "today" so the demo always shows a full
// current week (with the Grade 11 midweek stress spike) vs a calmer last week.

export const DEMO_SCHOOL = {
  id: 'demo-school-2026',
  name: 'Riverside High School',
  joinCode: 'DEMO2026',
  enrolled: {
    '7': 72,
    '8': 68,
    '9': 85,
    '10': 79,
    '11': 82,
    '12': 76
  }
};

// Small class within Grade 12 — fewer than 5 responses per day (suppression demo)
export const DEMO_SMALL_CLASS = { grade: '12b', enrolled: 31 };

export const MOODS = {
  sunny:  { label: 'Sunny',        hint: 'calm',       color: '#F59E0B', line: '#D97706', icon: 'sunny' },
  partly: { label: 'Partly cloudy', hint: 'okay',      color: '#0284C7', line: '#0369A1', icon: 'partly' },
  cloudy: { label: 'Cloudy',        hint: 'stressed',  color: '#64748B', line: '#475569', icon: 'cloudy' },
  stormy: { label: 'Stormy',        hint: 'overwhelmed', color: '#4338CA', line: '#3730A3', icon: 'stormy' }
};

export const MOOD_ORDER = ['sunny', 'partly', 'cloudy', 'stormy'];

export const TAGS = [
  { id: 'exams', label: 'Exams', icon: 'exams' },
  { id: 'friends', label: 'Friends', icon: 'friends' },
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'sleep', label: 'Sleep', icon: 'sleep' },
  { id: 'workload', label: 'Workload', icon: 'workload' },
  { id: 'other', label: 'Something else', icon: 'other' }
];

export const SUPPORT_RESOURCES = [
  { title: 'School counselor', subtitle: 'Visit the counseling office or send an email', placeholder: true },
  { title: 'A trusted adult', subtitle: 'Someone at home, school, or in your community you feel safe with', placeholder: true },
  { title: 'Local helpline', subtitle: 'Free and confidential — add your local helpline number here', placeholder: true }
];

// ---------- Deterministic pseudo-random ----------

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

// ---------- Mood mix per grade ----------

// Base weekly mood mix: [sunny, partly, cloudy, stormy]
const BASE_MIX = {
  '7':  [0.50, 0.30, 0.15, 0.05],
  '8':  [0.55, 0.30, 0.12, 0.03],
  '9':  [0.35, 0.35, 0.22, 0.08],
  '10': [0.25, 0.35, 0.28, 0.12],
  '11': [0.30, 0.35, 0.25, 0.10],
  '12': [0.30, 0.38, 0.24, 0.08]
};

// Grade 11 last week: calm baseline (so the stress spike triggers the alert)
const GRADE11_LASTWEEK = [0.42, 0.36, 0.15, 0.07];

function moodMixFor(grade, isCurrentWeek, midweek, dateStr) {
  const base = BASE_MIX[grade] || BASE_MIX['9'];

  // Grade 11, current week: stress rises through the week (exams)
  if (grade === '11' && isCurrentWeek && midweek >= 0) {
    const stressBoost = (midweek / 4) * 0.38; // Mon 0 .. Fri 0.38
    const sunny = Math.max(0.05, base[0] - stressBoost * 0.6);
    const partly = Math.max(0.10, base[1] - stressBoost * 0.4);
    const cloudy = base[2] + stressBoost * 0.6;
    const stormy = base[3] + stressBoost * 0.4;
    return [sunny, partly, cloudy, stormy];
  }

  // Grade 11, last week: calm
  if (grade === '11' && !isCurrentWeek) {
    return GRADE11_LASTWEEK.slice();
  }

  // Slight daily variation for everyone else
  const v = (hash01(dateStr + grade) - 0.5) * 0.06;
  return [
    Math.max(0.05, base[0] + v),
    Math.max(0.10, base[1] + v * 0.5),
    Math.max(0.05, base[2] - v * 0.5),
    Math.max(0.0, base[3] - v * 0.3)
  ];
}

function distribute(total, mix) {
  const counts = [0, 0, 0, 0];
  let remaining = total;
  for (let i = 0; i < 3; i++) {
    const c = Math.round(total * mix[i]);
    counts[i] = Math.min(c, remaining);
    remaining -= counts[i];
  }
  counts[3] = Math.max(0, remaining);
  return { sunny: counts[0], partly: counts[1], cloudy: counts[2], stormy: counts[3] };
}

// Local-date string (YYYY-MM-DD) — consistent with getDay() everywhere.
export function dateStrOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function tagDistribution(total, moods) {
  const tags = { exams: 0, friends: 0, home: 0, sleep: 0, workload: 0, other: 0 };
  const stress = moods.cloudy + moods.stormy;
  const tagTotal = Math.round(total * 0.8); // ~80% of check-ins include tags
  const stressRatio = stress / Math.max(1, total);

  // Exams track stress: the more stressed a group is, the more exams
  // dominate its tags (so the "rising reason" watch alert can fire).
  const examW = 0.08 + stressRatio * 0.85;
  const sleepW = 0.18;
  const workloadW = 0.20;
  const friendsW = 0.15;
  const homeW = 0.10;
  const otherW = 0.12;
  const sum = examW + sleepW + workloadW + friendsW + homeW + otherW;

  tags.exams = Math.round(tagTotal * examW / sum);
  tags.sleep = Math.round(tagTotal * sleepW / sum);
  tags.workload = Math.round(tagTotal * workloadW / sum);
  tags.friends = Math.round(tagTotal * friendsW / sum);
  tags.home = Math.round(tagTotal * homeW / sum);
  tags.other = Math.max(0, tagTotal - tags.exams - tags.sleep - tags.workload - tags.friends - tags.home);
  return tags;
}

// ---------- Generate 14 days of summaries ----------

export function generateDemoSummaries() {
  const summaries = [];
  const today = new Date();
  const grades = ['7', '8', '9', '10', '11', '12'];

  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = dateStrOf(d);
    const isCurrentWeek = i < 7;
    const dow = d.getDay(); // 0 Sun .. 6 Sat
    const isWeekend = dow === 0 || dow === 6;
    const midweek = isWeekend ? -1 : dow - 1; // Mon=0 .. Fri=4

    for (const grade of grades) {
      const enrolled = DEMO_SCHOOL.enrolled[grade];

      let partRate;
      if (isWeekend) {
        partRate = 0.26 + hash01(dateStr + grade + 'p') * 0.08;
      } else {
        partRate = 0.72 + hash01(dateStr + grade + 'p') * 0.14;
      }
      if (grade === '10') partRate *= 0.32; // Grade 10: low participation (alert demo)
      if (grade === '12') partRate *= 0.9; // Grade 12 slightly lower participation

      const total = Math.max(1, Math.round(enrolled * partRate));
      const mix = moodMixFor(grade, isCurrentWeek, midweek, dateStr);
      const moods = distribute(total, mix);
      const tags = tagDistribution(total, moods);

      summaries.push({
        schoolId: DEMO_SCHOOL.id,
        grade,
        date: dateStr,
        total,
        moods,
        tags
      });
    }

    // Grade 12 · Class B — a small class where only a couple of students
    // check in (Tue and Fri, 1–2 responses each), so the weekly total
    // stays under 5 and the privacy suppression screen is shown.
    if (dow === 2 || dow === 5) {
      const bTotal = 1 + Math.floor(hash01(dateStr + '12b') * 2); // 1–2
      const bMoods = distribute(bTotal, [0.5, 0.3, 0.2, 0.0]);
      const bTags = tagDistribution(bTotal, bMoods);
      summaries.push({
        schoolId: DEMO_SCHOOL.id,
        grade: '12b',
        date: dateStr,
        total: bTotal,
        moods: bMoods,
        tags: bTags
      });
    }
  }

  return summaries;
}

// Demo staff (for demo-mode sign-in)
export const DEMO_STAFF = [
  { uid: 'staff-teacher-1', schoolId: DEMO_SCHOOL.id, role: 'teacher', email: 'teacher@riverside.edu' },
  { uid: 'staff-counselor-1', schoolId: DEMO_SCHOOL.id, role: 'counselor', email: 'counselor@riverside.edu' }
];
