# Frontend API Integration: Changes So Far

> Historical snapshot from an earlier integration stage. Student workflows described below as “not yet migrated” have since been connected in the current frontend. See [INTEGRATION-REPORT.md](../Documentation/INTEGRATION-REPORT.md) for this merged checkout's scope and verification status.

This note records the frontend changes made so far. It is a handoff for the group and is intentionally explicit about what has and has not moved to the backend.

## Current scope

Authentication plus the admin and professor data modules now use the API. The application-data migration is still incomplete: student academic workflows and some calendar/announcement views remain local. The admin and professor workflow changes have passed JavaScript syntax checks only and still need testing against a running backend. Do not treat the application as fully connected to MariaDB yet.

Estimated overall integration progress is **roughly 55%**, counted by backend-owned data workflows rather than files or lines of code. This is an approximate planning estimate, not a completion metric. The whole frontend is not ready to be declared integrated.

The API gateway is `Frontend/API/api.js`. It calls the Java server at `http://localhost:8000/api` by default, sends JSON, adds the bearer token when available, unwraps `{ ok: true, data: ... }`, and raises an `ApiError` for server/network failures.

## Files changed

### `js/login.js`

**Before:** The browser read `cognitia_state.users`, compared the entered password against a locally stored password, and created a demo admin record in localStorage when no admin existed. It also allowed signing in with a student number.

**Now:** The form calls `CognitiaApi.auth.login({ email, password })`. On success it takes the returned `user`, saves a password-free profile through `CognitiaSession`, and redirects by role. The backend checks the password, account approval, account status, and role. The browser-side admin seed and local password comparison are removed. Login uses email because the current API contract accepts email, not student number.

**Why:** Credentials and account access decisions belong on the server. Keeping plain-text passwords in browser storage would expose them to anyone with access to that browser profile and would bypass the backend's password hashing and approval checks.

The terms-read flag still uses localStorage because it is a local preference, not account data.

### `js/register.js`

**Before:** Registration created a user object in `cognitia_state`, generated IDs in the browser, and stored the submitted password as plain text. It let the browser decide the new account's status and displayed a locally generated student number.

**Now:** Student and professor registration call `CognitiaApi.auth.register(...)` with the selected role. The server accepts only those two public roles, creates the account as pending, hashes its password, and returns its real ID. The admin account-approval screen can review either role. Public admin registration remains blocked; admins are provisioned by the backend bootstrap or an existing administrator.

**Why:** The database must assign durable IDs and the server must control account creation, password storage, and approval status. A second browser-generated account model would conflict with the server's records.

The success message tells the applicant to wait for approval and sign in by email. Professor access to courses still depends on an administrator assigning courses/sections after approval. The API contract's registration response does not include a student number, so the browser no longer invents one.

### `js/session.js`

**Before:** The current profile was saved in localStorage. The route guard compared the saved profile against the local `cognitia_state.users` list, and a helper could retrieve a user's locally stored password.

**Now:** A password-free display profile is saved in `sessionStorage` for the current tab. The route guard requires an API token, a saved profile, and the expected role. `clear()` removes the profile and API token. `getStoredPassword()` returns an empty value because the backend never returns or stores a browser-readable password.

**Why:** A local user list cannot prove identity or authorization. The server checks the token and permissions on protected API calls; the browser profile is only for displaying the signed-in user's name and role.

The token and display profile survive navigation/reload in the same tab. The server keeps tokens in memory, so a backend restart invalidates them and the user must sign in again.

### `js/admin.js`

**Before:** Sign-out only removed `cognitia_current_user` from localStorage.

**Now:** Admin users, programs, sections, courses, and announcements load from and save to the API through `API/admin-data.js`. The existing admin screens continue to use an in-memory view-model shape; browser `localStorage` is no longer the source for these records. Profile and password forms also submit to the user API. Sign-out calls the backend logout endpoint, clears the session profile and token, and then returns to the login page.

**Why:** Admin records must remain consistent across users and browsers, so the database is authoritative. The mapper converts the backend's relational records into the shapes the existing admin screens already render. Logout also invalidates the backend's in-memory token instead of merely clearing a browser copy.

### `js/professor.js`

**Before:** Sign-out only removed the local profile. The file also contained unresolved merge-conflict markers in the upcoming-announcements code, which made the JavaScript invalid and prevented the script from loading.

**Now:** Professor courses, roster, lessons, assignments/submissions, quizzes/attempts, grade views, and dashboard announcements load through the API adapter. Content creation/edit/deletion, assignment grading, essay grading, profile name updates, and file downloads call backend endpoints. The screens continue using their existing in-memory object shapes; academic records are no longer read or written through `localStorage`. Sign-out calls the backend logout endpoint and clears the tab session.

**Why:** The database is the durable source of course and grading data; the server checks professor ownership and calculates official grades. The adapter maps relational IDs and separate submission/attempt resources to the shapes the existing screens render. Personal calendar state remains local because it has no matching persistent endpoint in the current contract.

### `js/student.js`

**Before:** Sign-out only removed the local profile.

**Now:** Sign-out calls the backend logout endpoint and clears the tab session. Student courses, lessons, assignments, submissions, quiz attempts, progress, and grade views still use their existing local-data helpers and are **not yet migrated**.

**Why:** The server should invalidate the session token. Student academic data must be moved separately because those flows need to map the current nested local records to separate API resources.

## Required HTML script loading changes

`login.html`, `register.html`, `admin.html`, `professor.html`, and `student.html` now load `API/api.js` before their scripts that use it. No layout or CSS changes were made.

## Admin account approvals

The approval screen now loads user records from `GET /api/users` and sends approve/reject actions to `PUT /api/users/{id}/approval`. The backend returns the updated user record, which replaces the matching in-memory row. The view uses the API's `studentNo` field for student IDs. Account data and review decisions are no longer read or written through `localStorage` in this screen.

## Announcements and admin activity

The standalone bulletin reader and top-bar notifications load announcements from the API. Opening an announcement or marking it read calls the backend read endpoint. Admin announcement editing and the professor dashboard bulletin use the API; the separate student announcement widget still uses local state. API-backed admin changes are recorded by backend audit handlers. Admin activity history comes from `GET /api/activity`.

## What remains local for now

- Student progress, submissions, quiz-result copies, other student data, and its separate announcement widget.
- Some announcement widgets and calendar-derived academic data, including personal professor calendar events.
- Local UI preferences such as theme, sidebar state, terms acceptance, and calendar ticks.

These remaining academic records should move to the API; local UI preferences can remain in browser storage when they are intentionally browser-specific.

## Verification status

`node --check` passed for `js/admin.js`, `API/admin-data.js`, `js/professor.js`, and `API/professor-data.js`. No admin or professor workflow has yet been run against a live backend, so CRUD behavior, file handling, grading, and field compatibility remain unverified. Student learning-data migration is outstanding. Do not mark full frontend integration complete until those workflows are API-backed and checked end to end.

