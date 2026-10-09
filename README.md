# MoodWeather

An anonymous school wellbeing check-in tool. Students tap one mood a day; staff see only anonymous group patterns (a "mood weather map") so they can respond early. It shows patterns, never diagnoses, and never identifies individual students.

Built for a student hackathon. Plain HTML, CSS, and vanilla JavaScript (ES modules). No build step, no frameworks, no third-party libraries except the official Firebase modular SDK.

## Quick start (demo mode)

The app uses ES modules, so it must be served over HTTP (opening `index.html`
directly from disk via `file://` will not work). Any static server works:

```
cd MoodWeather
python -m http.server 8000        # or: npx serve
```

Then:

1. Open `http://localhost:8000` in a browser.
2. Join code: **DEMO2026**, any grade 7–12.
3. The app runs in **demo mode**: data is stored in `localStorage` and seeded with one school week of realistic counters (re-seeded each day). A "Demo mode" banner appears on every screen.
4. Staff dashboard: open `http://localhost:8000/staff.html`. In demo mode, sign in with **teacher@riverside.edu** or **counselor@riverside.edu** (any password).

The UI code does not care which mode is active — `js/data.js` provides the same functions in both modes. If the Firebase config is real but Firestore is unreachable (not set up, offline, permission denied), the app automatically falls back to demo mode and shows the banner.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Student app (join, welcome, mood, tags, thank-you, privacy, how-it-works) |
| `staff.html` | Staff dashboard (sign-in, overview, grade detail, alerts, guidance) |
| `css/style.css` | Shared styles (student + staff) |
| `js/firebase.js` | Firebase config + demo-mode detection |
| `js/data.js` | Data layer (Firestore or localStorage, same API) |
| `js/student.js` | Student app logic |
| `js/staff.js` | Staff dashboard logic |
| `js/demo-data.js` | Seeded demo school + one school week of counters |
| `firestore.rules` | Firestore security rules |

## Firebase setup (production mode)

1. **Create a Firebase project** at [console.firebase.google.com](https://console.firebase.google.com).
2. **Enable Firestore** (Build → Firestore Database → Create database, start in production mode).
3. **Enable Email/Password auth** (Build → Authentication → Get started → Sign-in method → Email/Password → Enable).
4. **Register a web app** (Project settings → Add app → Web) and copy the config object.
5. **Paste the config** into `js/firebase.js` (replace the placeholder values). When the config is real, the app automatically switches from demo mode to Firebase mode.
6. **Publish the security rules**: copy `firestore.rules` into the Firestore Rules tab.
7. **Add a school document** in the `schools` collection (use a `schoolId` without underscores — document IDs in `summaries` and `handled` embed it as the first segment):
   ```
   schools/{schoolId}: { name: "Your School", joinCode: "YOURCODE", enrolled: { "7": 100, "8": 95, ... } }
   ```
8. **Add staff documents by hand** in the `staff` collection (one per authorized user):
   ```
   staff/{uid}: { schoolId: "{schoolId}", role: "teacher" | "counselor" }
   ```
   The `uid` is the user's Firebase Auth UID (visible in the Authentication tab).
9. **Publish** the folder to Firebase Hosting, GitHub Pages, or Netlify drop:
   ```
   firebase init hosting   # then: firebase deploy
   ```

## How it works

1. **Student taps a mood** — no name, no account, no email.
2. **A counter goes up by one** — the check-in only increments group totals using `increment(1)`. No individual check-in records are ever stored.
3. **Summaries are protected** — groups with fewer than 5 responses show "Not enough responses to display" with no numbers rendered.
4. **Staff see the weather map** — dominant mood per grade, participation rate, and trend vs last week.

### Firestore design

- `schools/{schoolId}`: name, joinCode, enrolled counts per grade
- `summaries/{schoolId_grade_YYYY-MM-DD}`: total, moods, tags — incremented by exactly 1 per check-in
- `limits/{sha256(randomDeviceToken + date)}`: empty, create-only document used to stop repeat check-ins (token generated on device, stored in localStorage, hashed with `crypto.subtle`)
- `staff/{uid}`: schoolId, role
- `handled/{schoolId_grade_alertKey}`: handledBy, handledAt

### Alert rules (plain rules, no AI)

- If a group has ≥ 10 responses and its Cloudy + Stormy share rose **20 percentage points or more** vs last week → high-priority alert naming the top reason.
- If average daily participation is **below 30%** → medium-priority low-participation alert.
- If a reason tag reaches **≥ 25% share** and rose **≥ 10 points** vs last week → watch-level "rising fast" alert.

## Accessibility

- Every mood uses **icon AND label** (never color alone)
- High-contrast text, large tap targets, system font stack
- Large-text option (persisted)
- Keyboard navigation (arrow keys in the mood grid, focus management between screens)
- Charts include an SVG `aria-label` summary plus a "view data as table" fallback

## Known limits

- **The once-a-day limit can be bypassed by clearing browser data.** The limit is a client-side convenience, not a security control.
- **Group suppression is a display rule.** In a production version a server-side function would compute summaries so staff accounts never touch small-group counters.
- **Patterns depend on participation**, and a school must follow its own data-protection rules before using it.

## Privacy

- No names, no accounts, no emails on the student side
- Only group counters are stored; no individual check-in records exist
- Groups under 5 responses are hidden from display
- MoodWeather never diagnoses and never gives medical advice
