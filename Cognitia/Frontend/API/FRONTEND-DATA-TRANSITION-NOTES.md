# Cognitia Frontend Data Transition Notes

Short project handoff for the frontend team. This note describes the current frontend and its move to the Java API. It is a working guide, not a claim that the migration is complete.

## Current status

**Estimated integration progress: roughly 80% of the frontend's backend-owned data workflows.** This is a coarse planning estimate, not a count of files or lines. Authentication, registration, logout, approval review, admin management, professor teaching/grading workflows, student learning workflows, announcement reading, activity-log reading, and academic calendar readers now use API-backed data. Recent admin, professor, student, and calendar changes have only passed JavaScript syntax checks; none of those role workflows has completed end-to-end verification against MariaDB. This estimate does not mean the application is fully integrated.

**Status: integration is in progress, not complete.** The authentication and shared-reader slice can be tested. Do not report that the full frontend/backend integration is done yet.

- The Java backend and its API contract are in place, and the backend smoke test passed in the developer's environment.
- `API/api.js` is a standalone browser API gateway. It defaults to `http://localhost:8000/api`, sends JSON requests, unwraps the backend's `{ ok, data }` replies, reports `{ ok, error }` replies, and keeps the login token in `sessionStorage`.
- Login, registration, and session handling are now switched to the API. `API/api.js` is loaded by the login, registration, admin, professor, and student pages.
- Login no longer checks local passwords or seeds a browser admin. Public registration uses the API for student and professor applicants; both start pending and can be reviewed by an admin. Public admin registration is rejected by the backend. Session profile/token data is tab-scoped in `sessionStorage`.
- The admin account-approval screen now loads users from `GET /api/users` and submits decisions through `PUT /api/users/{id}/approval`; the browser no longer saves approval decisions in `localStorage`.
- The standalone Campus Bulletin reader, top-bar notifications, and student bulletin widget read announcements from the API; read markers are stored by the backend. The admin activity screen reads the backend audit log. API-backed admin actions are recorded by the server's applicable audit handlers.
- Admin users, programs, sections, courses, and announcements now load/save through `API/admin-data.js` and the contract endpoints. `js/admin.js` keeps the existing screen/view-model shape in memory; those admin records are no longer persisted in `localStorage`. Admin profile and password changes also call the user API. No CSS/layout redesign was part of this work.
- Admin saves that touch several entity types are sent as a sequence of API requests because the contract has no multi-entity transaction endpoint. If a later request fails, earlier requests may already be committed; the admin page reloads server state and reports the failure. Review the resulting data before retrying a multi-record operation.
- Existing demo records in browser storage will not be imported automatically. The selected direction is to use records already in MariaDB as the source of truth. Migrated role pages now display backend records.
- Student courses, lessons, submissions, quiz attempts, grades, announcements, profile edits, and lesson completion now use the API through `API/student-data.js` and `API/api.js`. Student academic records no longer use `cognitia_state` or `cognitia_student_data`.
- Student calendar choices and sample/personal calendar events remain browser-local because the backend contract has no corresponding endpoints. End-to-end workflows are still unverified, so the frontend is not yet fully integrated.
- Student assignment/quiz deadlines and recent submission/attempt activity, and professor assignment/quiz due dates, now come from the API-backed role adapters. Admin scheduled announcements were already read from the admin page's API-loaded in-memory state. Personal calendar events and tick/removal choices remain local because there are no matching endpoints.
- No CSS files or page layout styles were changed. The assignment-list controls and labels were kept in the existing rendering; lesson-file links now fetch the file on demand.

## How data is stored today

The migrated role pages no longer read or write legacy academic records in `localStorage`. Older browser profiles may still contain stale data under legacy keys; it is unused and is not imported or automatically deleted. Active storage is limited to session credentials/profile and local UI preferences:

| Key | Current contents |
|---|---|
| `cognitia_state` | Legacy combined academic data may remain in older browser profiles. No active frontend page reads, writes, or imports it. |
| `cognitia_student_data` | Legacy student data may remain in older browser profiles. The student page no longer reads or writes it. |
| `cognitia_prof_data` | Legacy professor data may remain in older browser profiles. The professor page no longer imports or reads it. |
| `cognitia_current_user` | Safe, password-free profile stored in `sessionStorage` for the current tab through `CognitiaSession`; not a `localStorage` key anymore. |
| `cognitia_next_student_id` | Obsolete browser-generated student-ID counter. Its generator and page includes have been removed; student numbers come from the backend. A stale local value, if present, is unused. |
| `cognitia_terms_read` | Whether the user accepted/read terms. |
| `cognitia_cal_done:<userId>`, `cognitia_cal_deleted:<userId>` | Student calendar tick/removal choices. |
| `cognitia_sidebar_*`, `cognitia-theme` | Sidebar state and theme preference. |

Older browser profiles may retain duplicated demo records, but the migrated role pages no longer read them as academic data. The student page keeps fetched records in memory for rendering and sends writes to the API.

## Planned storage after API integration

| Data | Planned source of truth | Notes |
|---|---|---|
| Users, passwords, approvals, profiles | Backend `users` records | Passwords are hashed and never returned. Login uses email and password; the backend API does not support student-ID login. |
| Programs, sections, courses | Backend academic endpoints and MariaDB | Backend stores section/course/program relationships as linked records rather than frontend-only arrays/labels. |
| Announcements and read state | Backend announcement endpoints and MariaDB | Per-user read marks are stored by the backend. |
| Lessons and lesson files | Backend lesson endpoints and MariaDB | Section assignments use IDs. Lesson completion is supported. |
| Assignments, submissions, files, grades | Backend assignment/submission endpoints and MariaDB | A submission is a separate record, not nested inside the assignment. The server records grading. |
| Quizzes, questions, attempts, essay grades | Backend quiz/attempt endpoints and MariaDB | Student quiz responses omit correct answers and essay rubrics; scoring is server-side. |
| Course grades | Calculated by backend from graded assignments and quizzes | Grades are returned by `/api/grades`; the current contract does not store a separate grades table. |
| Admin activity log | Backend activity endpoint and MariaDB | The server records applicable admin actions; the browser should not invent/send log rows. |
| Login token | `sessionStorage` through `API/api.js` | Cleared at logout or after an unauthorized response. Backend restart also invalidates tokens. |
| Theme, sidebar, terms, calendar ticks | Browser storage, if retained | These are local preferences/UI state, not shared academic records. Calendar ticks need a decision if they should become cross-device data. |

The intended rule is: the backend is authoritative for shared academic records; browser storage may hold local presentation preferences only. Avoid keeping shadow copies of server records in `localStorage`, because those copies can become stale or conflict with database changes.

## Frontend files likely to need changes

The following files are either already API-backed or remain in the migration queue.

| File | Current responsibility | Planned change |
|---|---|---|
| `js/login.js` | Previously found accounts in local state and seeded a browser admin. | **Updated:** authenticates using `CognitiaApi.auth.login`; local password checks and browser admin seeding removed. Terms acceptance remains local. |
| `js/register.js` | Previously created pending accounts in local state. | **Updated:** calls `CognitiaApi.auth.register` with the selected student/professor role. Both roles await admin approval; the backend rejects public admin registration. |
| `js/session.js` | Previously saved a profile locally and validated it against local users. | **Updated:** stores only a password-free profile in `sessionStorage`; checks token/profile/role in the route guard. API authorization remains authoritative. |
| `js/admin.js` | Admin screens and in-memory view state for users, programs, sections, courses, and announcements. | **API-backed; workflow verification pending:** uses `API/admin-data.js` for load/save while keeping the current view shape and layout. Profile/password updates also use the API. It no longer persists these records to localStorage. |
| `js/approval.js` | Previously changed approval state locally. | **Updated:** loads accounts from the user endpoint and submits approval/rejection decisions to the API; the returned server record updates the view. |
| `js/professor.js` | Professor dashboards and teaching workflow screens. | **API-backed; workflow verification pending:** reads assigned courses, students, sections, lessons, assignments/submissions, quizzes/attempts, grades, announcements, and saves content/profile/grades through the API. The UI keeps its existing view-model shape. Personal calendar items remain browser-local. |
| `js/student.js` | Student learning screens, progress, profile, and announcements. | **API-backed; workflow verification pending:** reads API-backed course/content/submission/attempt/grade/announcement data through `API/student-data.js`; writes profile edits, lesson completion, assignment submissions, and quiz attempts to the API. Only the student calendar preferences/events remain local. |
| `js/activity.js` | Previously created and read browser activity rows. | **Updated:** reads `GET /api/activity`; server handlers own audit-row creation. |
| `js/notification.js`, `js/bulletin-reader.js`, `js/topbar.js` | Previously read announcement data/read marks from local state. | **Updated:** top-bar notifications, the standalone bulletin reader, and the student bulletin widget load announcements and save supported read markers through the API. |
| `js/student-calendar.js` | Student mini-calendar, deadlines, recent activity, and local calendar choices. | **Updated; workflow verification pending:** academic deadlines and activity use API data emitted by the student page; personal events and calendar tick/removal choices remain local. |
| `js/prof-calendar.js` | Professor mini-calendar and upcoming assignment/quiz dates. | **Updated; workflow verification pending:** academic dates use `CognitiaProfessorData`'s API-backed in-memory view; personal calendar events remain local. |
| `js/calendar.js` | Admin scheduled-announcement calendar. | Already uses `window._cognitiaState.announcements`, populated from the API by `js/admin.js`; no browser-storage migration was needed. |
| `js/student-id.js` | Previously generated browser-side student IDs. | **Removed:** the backend supplies `studentNo`; unused script references and the generator were removed. |
| `js/academic-config.js` | Supplies a fixed frontend catalog. | Compare with backend academic records and remove duplicate catalog sources if API data fully replaces them. |
| `js/professor.js` legacy migration | Previously imported `cognitia_prof_data` into the combined local state. | **Removed:** the professor page no longer imports old browser records. Existing local demo content is not copied into MariaDB automatically. |

`theme.js`, `sidebar.js`, and the terms flag may continue using browser storage. Page HTML will need to load `API/api.js` before scripts that call it, but the layouts and CSS should not need redesign.

## Mapping issues to handle during implementation

- The professor adapter translates lesson, assignment, and quiz section labels to API `sectionIds[]`; the student adapter receives content already scoped by the backend to the signed-in student's section.
- The professor and student adapters translate backend course/program links to the screen's numeric `programIds[]` view model.
- Frontend professor assignments keep nested `submissions[]` in memory for rendering; the adapter reads and writes the API's separate submission records.
- Frontend professor and student quizzes keep nested `attempts[]` in memory for rendering; their adapters map the API's separate attempt/answer records. The student view never receives quiz correct answers or rubrics.
- Frontend creates browser IDs with counters or timestamps; the backend returns real IDs. UI state must replace temporary IDs after a successful create.
- The API returns errors asynchronously. Save UI should only show success after the server confirms the write, and should display useful errors when it rejects the request.
- The API limits each role's data. Do not fetch every record and filter it only in the browser.
- Backend connectivity requires the Java server and MariaDB to be running. A backend restart clears in-memory login tokens.

## Suggested migration order

1. **Done:** connect login, registration, logout, and session display to the backend.
2. **Done:** connect approval review, announcement reading/read markers, and activity-log reading.
3. Build and document explicit mappers for backend records and the frontend's current view models. Keep rendering/layout intact while changing data boundaries.
4. **Implemented; needs workflow testing:** admin user management, academic structure, announcements, and profile/password saves use API calls and an explicit mapper. The database is the source of truth; existing local demo records are not migrated automatically.
5. **Implemented; needs workflow testing:** professor lessons, assignments/submissions, quizzes/attempts, essay and assignment grading, and grade views use API endpoints through `API/professor-data.js`.
6. **Implemented; needs workflow testing:** student courses, lesson completion, submissions, quiz attempts, grades, profile edits, and bulletin data use the API.
7. **Implemented; workflow verification pending:** student and professor calendar readers consume API-backed academic data; the admin announcement calendar already consumed API-loaded state. Personal calendar events and tick/removal choices remain local until the contract/schema supports them.
8. **Done for current consumers:** removed the unused browser student-ID generator and its page includes. No active role page reads/writes legacy academic-data keys; old values may remain in browser profiles but are ignored. Keep only approved local preferences/session data.
9. Run end-to-end admin, professor, and student workflow checks against the running backend before calling integration complete.

## Why the remaining files cannot simply be left untouched

Calendar readers are not just decorative. They combine academic deadlines and activity with personal events. Student and professor academic calendar data now comes from their API-backed adapters; admin announcement dates use admin's API-loaded state. Personal calendar events and tick/removal choices remain local-only because no persistent API endpoint exists for them. Student lesson completion, submissions, quiz attempts, and grades use their role-specific API endpoints. The student adapter requests records available to the signed-in student and keeps the page's working view model in memory.

Suggested approach: verify the admin, professor, and student workflows, including calendar dates, against the running backend. Add calendar persistence endpoints only if personal events or completion ticks need to sync across devices. The role adapters map API records into in-memory view models, wait for server confirmation before reporting saves, and display API errors through the existing UI.

### Admin API mapping constraints

- The current schema supports one year level per course/program relationship. The admin mapper stops a save if the existing UI tries to assign the same course to multiple years for one program.
- The backend generates `studentNo` when a student account is created. Since the update endpoint does not assign it when changing another role into student, the admin form blocks that role conversion; create a new student account instead.
- API saves affecting multiple records are sequential and can partially complete. On error, the UI reloads the backend snapshot, but already completed requests are not rolled back.
- The professor course overview's completion percentage now uses assignment submissions and quiz attempts returned by the API. The current contract does not provide professors with per-student lesson completion lists, so lessons are not included in that percentage.
- Student quiz questions deliberately omit correct answers and essay rubrics. The Java backend scores objective questions and grades remain server-calculated; the student page shows awarded points/feedback without exposing answer keys.
- The student role cannot list all users, so the course-card professor name is not populated unless the course endpoint supplies one. Do not expand the student page to fetch the admin-only user directory just to fill this display field.
- Existing browser demo data is not imported into MariaDB. Students see records already assigned to their database account/program/section after signing in.

## Defense notes

- `API/api.js` is a gateway: it centralizes the server address, bearer token, JSON encoding/decoding, and error handling. Pages should not each implement their own `fetch` logic.
- MariaDB is the durable source of shared data. Browser storage is per browser and can be edited by its owner, so it must not decide account roles, grades, approvals, or access.
- The Java server checks role/ownership and computes scores. Hiding a button in JavaScript is not a security check.
- The database stores relationships using IDs and link tables. The frontend can still display friendly labels, but it should translate them to IDs when sending changes.
- The current API token is held in `sessionStorage` so it survives page navigation/reload in the same tab. It is not durable login: a backend restart clears the server-side token map.
- The API contract currently has no persistent endpoint for assignment/quiz “done” ticks or calendar events. Lesson completion is supported. Those other items must remain local preferences or be added to the backend contract/schema before being treated as shared data.

## Source references

- Backend plan: `BACKEND-PLAN.md`
- API contract: `API-CONTRACT.md`
- Frontend inventory: `DATA-INVENTORY.md`
- API implementation: `API/api.js`
- Admin data mapper: `API/admin-data.js`
- Professor data mapper: `API/professor-data.js`
- Student data mapper: `API/student-data.js`

