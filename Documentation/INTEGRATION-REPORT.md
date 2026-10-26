# Cognitia Frontend and Backend Merge Report

**Status: integrated source; live workflow verification remains outstanding.** This report reflects the merged checkout on 2026-10-20.

## Sources and files

- ZIP 2 (`Cognitia.zip`) is the interface source of truth. The existing `Cognitia/` HTML, CSS, presentation assets, and unintegrated helper scripts were retained; the ZIP itself was not modified.
- ZIP 1 supplied `Backend/` (Java sources, schema, JDBC driver, build/test artifacts and batch scripts), `API/` (gateway and role adapters), `Documentation/reference/`, and `README-backend.md`. Those components were added under the existing `Cognitia/` project.
- API-enabled JavaScript modules were integrated for login/session, admin data, professor and student data, approvals, announcements, notifications, activity, and calendars. The updated page designs and styles remain in place.

## Compatibility findings and fixes

- The updated pages did not load the backend API gateway and role adapters. Added the API and adapter scripts before page scripts on login, registration, admin, professor, and student pages.
- The backend launch script expected an absent `Frontend/` directory. `Backend/start.bat` now serves the merged project root, where the HTML files actually live.
- The backend accepts school email for login; the updated login copy implied student-ID login. The label, placeholder, and validation now match the email-only contract.
- The frontend's browser student-number generator was unreferenced after integration and could conflict with server-issued numbers. Its script was removed after confirming there were no page or code references.
- The updated admin UI includes enrollment visualization and program/course filters absent from the older API frontend. Those view functions were carried into the API-backed admin module, and the pending-approval preview now reads server-loaded users.
- Personal calendar events in the updated Professor and Student interfaces have no API endpoint; account-scoped local persistence was retained for those events. Calendar completion ticks/removals also remain local.
- Announcement media has no persistence endpoint. The updated preview remains available, the UI says it is preview-only, and publishing with a selected file is blocked with an explanatory message.
- Historical auth notes described student workflows as unintegrated and were marked as a prior snapshot. The supplied API contract now points to the actual `API/api.js` path.

## Data handling and remaining constraints

- Users, credentials, approvals, programs, sections, courses, announcements, lessons, assignments, submissions, quizzes, attempts, and grades use the backend adapters/endpoints. The backend remains authoritative for IDs, authorization, and grade calculations.
- Local storage remains for presentation preferences, terms acceptance, and student calendar ticks/removals. Personal calendar events and those tick/removal choices have no persistence endpoints and do not sync across devices.
- Announcement media is preview-only. A course/program link supports one year level in the current schema; an attempted multi-year mapping is rejected by the adapter. Multi-record admin saves issue sequential API calls and can partially persist if a later request fails.
- Existing browser demo data is not imported into MariaDB, and stale local storage is not automatically deleted. No database migration, reset, or record import was performed. If important records exist only in an older browser profile, plan and review a separate migration before relying on the new backend source of truth.
- The supplied static academic catalog remains in the frontend for UI choices; confirm its entries match the institution's database catalog before production use.

## Verification

- `node --check` passed for all 26 JavaScript files under `js/` and `API/`.
- All local `src` and `href` references in the HTML pages resolved.
- The Java backend sources and `BackendSmokeTest.java` compiled with `javac --release 21`.
- `git diff --check` passed with CRLF recognized as a line ending.
- The smoke-test program itself was not run: it creates temporary records and requires a running API, MariaDB, and bootstrap admin, so it should only run against an approved development database.
- At merge time no API was listening on `localhost:8000` and MariaDB was not listening on port `3306`. Therefore no login, CRUD, persistence, role-permission, upload/download, or cross-role workflow has been verified against a live database. Do not describe the merge as end-to-end verified.

## Run locally

1. Start MariaDB and import `Backend/rcs/schema.sql` using an approved development database.
2. Check `Backend/rcs/util/Database.java` for local connection settings; do not publish credentials.
3. Run `Backend/start.bat` from Windows with a JDK that supports `--release 21`.
4. Open `http://localhost:8000/login.html`. Use the locally provisioned administrator account; do not reuse development credentials in a shared deployment.
5. With the backend and a disposable development database running, run `Backend/runtest.bat` for its API smoke checks, then verify the merged UI workflows listed in this report.
