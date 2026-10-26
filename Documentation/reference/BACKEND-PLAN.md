# Cognitia – Backend Plan

## 1. Big picture

```
Browser pages  →  js/api.js  →  (HTTP + JSON)  →  Java server  →  JDBC  →  MariaDB (in XAMPP)
 (HTML/CSS/JS)   single gateway                   HttpServer                 tables from schema.sql
```

Each part talks only to its neighbour. Pages never see the server; the server never sees the pages.

## 2. Role of every part

| Part | Role | Never does |
|---|---|---|
| **Front end** (HTML/CSS/JS) | Shows screens, reads the in-memory state, calls `api.js` to save. | Talks to the server directly, stores data in localStorage (except theme, sidebar, terms flag, calendar ticks). |
| **api.js** | The only gateway. Holds the token, adds it to every request, keeps the loaded state plus a snapshot, finds what changed (diff) and sends only that. Turns error replies into messages. | Decides permissions or computes scores. |
| **Java server** (built-in `HttpServer`) | Receives each request, finds the right handler by path and method, checks login and role, calls the database, builds the reply. This is the only place rules are enforced. | Trusts anything the browser says about its own role. |
| **Helpers** | Small shared tools so handlers stay short: **Json.java** (your existing one, a black box: text ↔ objects), **password helper** (Java's built-in hashing with a random salt; stores `salt:hash`), **token store** (in-memory map: token → user id + role), **reply helper** (writes `{ok, data}` / `{ok, error}` and the status code, plus CORS headers), **activity helper** (writes a log row after admin actions). | Touch the database except the activity helper, through the JDBC bridge. |
| **JDBC bridge** | One class that opens a connection to MariaDB and runs prepared statements. All SQL lives behind it, grouped per topic (users, courses, lessons...). Multi-row saves (e.g. section + its course and professor links) run in one transaction: all or nothing. | Build SQL by gluing user text into strings (prepared statements only). |
| **XAMPP** | Runs MariaDB on your computer (start it from the control panel; default port 3306). | Anything about the app itself. |
| **MariaDB** | Stores the data, and enforces keys and uniqueness (email, one submission per student per assignment...). | Know about roles or tokens. |
| **SQL (`schema.sql`)** | Creates the database and the 23 tables; this is the single source of what is stored. | Contain data rules the server must still check (who may call what). |

## 3. How the server is organised (plain names, no code)

- **Main** – starts the server, registers one handler per area (auth, users, academics, announcements, lessons, assignments, quizzes, grades, activity), starts listening.
- **One handler per area** – matches the endpoints in `API-CONTRACT.md`.
- **Auth check** – a small step every handler runs first: read the token → find user → compare role with the endpoint's allowed roles. 401 if no token, 403 if wrong role.
- **Data classes** – one per topic, the only code that holds SQL.
- **Config** – database URL, user, password, port. Nothing else hard-coded.

## 4. Data flows

### Login
1. Student types email + password on the login page.
2. `api.js` sends `POST /api/login`.
3. Handler asks the data layer for the user by email.
4. Password helper hashes the typed password with the stored salt and compares.
5. If it matches and the account is approved and active: token store creates a random token and remembers the user.
6. Reply: `{token, user}` (no password). `api.js` keeps the token, stores the user as the session, redirects by role.
7. Wrong password, unknown email, or pending/rejected account → error reply; the page shows the message.

### Load (after login and whenever a page opens)
1. `api.js` calls the GET endpoints that the role may use (e.g. student: courses, lessons, assignments, quizzes, announcements).
2. For each call the server checks the token, then runs a query already limited to what that user may see (a student gets only their own section's items, with no quiz answers).
3. Server replies with lists. `api.js` builds the in-memory state in the same shape the pages already read and keeps an untouched snapshot copy.
4. Pages render from the state as before.

### Save
1. A page changes the state and calls save (e.g. professor edits a lesson).
2. `api.js` compares state with the snapshot: new → POST, changed → PUT, removed → DELETE; only those records are sent.
3. The server checks token, role and ownership ("is this lesson yours?"), validates the fields, writes to the database (in a transaction if several tables are touched), writes an activity row if it was an admin action.
4. Reply carries the saved record with its real id. `api.js` updates the state and snapshot.
5. On error: the message is shown and `api.js` reloads from the server so the screen matches the database.
6. Actions with server-side logic (register, approve, mark done, submit, grade, quiz attempt) skip the diff and call their own endpoint directly.

## 5. Defense cheat-sheet

**Why plain HttpServer and no framework?** The course goal is to understand requests, routing and JSON by hand. `HttpServer` ships with Java, so the only outside file is the MariaDB driver.

**Why one gateway (`api.js`)?** One place for the token, errors and the base URL. If an endpoint changes, one file changes, not every page.

**What is the diff/sync idea and why?** The old pages already work on one big state object. Comparing it with a snapshot lets them keep working while only changed records go to the server. The server stays a normal REST API.

**Why not just send the whole state every time?** It would overwrite other people's changes and cannot be permission-checked per record.

**How are passwords protected?** Never stored or returned in plain text. The server hashes them with Java's built-in hashing and a random salt per user, and compares hashes on login.

**Where are permissions checked?** Only on the server, on every request. Hiding a button in the browser is for looks, not security.

**What stops SQL injection?** Prepared statements: user values are passed as parameters, never joined into the SQL text.

**Why are there link tables like `lesson_sections`?** One lesson can go to many sections, and one section gets many lessons. A table of pairs removes the "BSCS 1A" text and keeps data in one place.

**Why is there no grades table?** Grades can be calculated from submissions and quiz answers. Storing them too would duplicate data that can go out of sync.

**Why does the server mark quizzes, not the browser?** The browser never receives correct answers, so a student cannot read them or fake a score.

**How do sessions work?** A random token in server memory. Simple to explain; the weakness is that a server restart logs everyone out.

**Why are files in the database?** The front end already treats files as text inside records; keeping them as blobs is the smallest change. Lists leave them out so loading stays fast.

**What happens if two users edit the same record?** Last save wins. No merge, acceptable for this scale.

**How do you keep the database and the server in step?** The tables come from `schema.sql`; the server only uses columns defined there. A data change means editing the SQL file first.

**Why does the Java server need CORS headers?** If the pages are opened from another port (e.g. VS Code Live Server), the browser blocks the calls unless the server says it allows that origin.

## 6. Known limits (say these before you are asked)

- Tokens are lost on restart; no expiry yet.
- Plain HTTP only; real deployment would need HTTPS.
- No automatic tests, no pagination, no file-size limit beyond what the server enforces.
- Grade formula is copied from the current front end; if it is wrong there, it stays wrong here.
- Each request opens its own database connection; fine for a class project, a pool would be the next step.
