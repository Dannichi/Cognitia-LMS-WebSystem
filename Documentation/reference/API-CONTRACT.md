# Cognitia – API Contract

The browser talks to the server through `API/api.js` (loaded by each page that uses the API). All requests and replies are JSON.

## 1. Common rules

- **Base path:** `/api`. Dates are ISO text (`2026-10-20T08:00:00`). IDs are numbers.
- **Login token:** `POST /api/login` returns a `token`. `api.js` keeps it and sends `Authorization: Bearer <token>` on every other call. The server keeps tokens in memory (a restart logs everyone out; no extra table).
- **Reply shape:** success `{ "ok": true, "data": ... }`, failure `{ "ok": false, "error": "message" }`.
- **Status codes:** 200 ok, 400 bad input, 401 not logged in, 403 role not allowed or not your record, 404 not found, 409 duplicate (e.g. email).
- **Roles:** A = admin, P = professor, S = student, any = any logged-in user, public = no login.
- **Server decides:** ids, `studentNo`, password hashing, timestamps, scores and grades. The browser never sends them.
- **Never returned:** passwords or hashes.
- **Files:** sent as text (base64) in `fileData`. List replies leave `fileData` out; use the `/file` endpoints to download.
- **Activity log:** the server writes it itself after admin actions. The browser does not send log entries.

## 2. Login and registration

| Call | Who | Browser sends | Server replies |
|---|---|---|---|
| POST /api/register | public | role (`student` or `professor`), firstname, middlename, lastname, email, phone, password; `programId` and `sectionId` may be supplied for a student | `{id}` and `studentNo` is assigned to students in the database. Student and professor accounts start pending; public admin registration is rejected. 409 if email exists |
| POST /api/login | public | email, password | `{token, user}`. 403 if pending, rejected or inactive |
| POST /api/logout | any | – | `{}` |
| GET /api/me | any | – | `user` (no password) |

## 3. Users

| Call | Who | Browser sends | Server replies |
|---|---|---|---|
| GET /api/users?role=&approval= | A all; P students only | optional filters | list of users |
| POST /api/users | A | user fields + password | `{id, studentNo?}` |
| PUT /api/users/{id} | A any user; any own profile (name, phone, password only) | changed fields | updated `user` |
| PUT /api/users/{id}/approval | A | approvalStatus (approved/rejected) | updated `user` (server sets reviewedAt, reviewedBy) |
| DELETE /api/users/{id} | A | – | `{}` |

## 4. Programs, sections, courses

| Call | Who | Browser sends | Server replies |
|---|---|---|---|
| GET /api/programs | public | – | list of programs |
| POST / PUT / DELETE /api/programs[/{id}] | A | code, name, desc, status, color, catalogId, departmentId, campusId | program / `{}` |
| GET /api/sections | public | – | list; each has year, letter, capacity, `courseIds[]`, `professorAssignments[{professorId, courseIds[]}]` |
| POST / PUT / DELETE /api/sections[/{id}] | A | programId, year, letter, capacity, courseIds[], professorAssignments[] | section / `{}` |
| GET /api/courses | A all; P courses they teach; S active courses of own program | – | list; each has `programs[{programId, year}]`, semester, units, status |
| POST / PUT / DELETE /api/courses[/{id}] | A | code, name, semester, units, status, programs[{programId, year}] | course / `{}` |

Saving a section or course replaces its link rows (courses, professors, programs) with the lists sent.

## 5. Announcements

| Call | Who | Browser sends | Server replies |
|---|---|---|---|
| GET /api/announcements | any. A sees all; others see only published ones for their audience | – | list, each with `read` true/false for the caller |
| POST / PUT / DELETE /api/announcements[/{id}] | A | title, body, type, category, audience, featured, status, scheduledAt, eventDate | announcement / `{}` |
| POST /api/announcements/{id}/read | any | – | `{}` |

## 6. Lessons

| Call | Who | Browser sends | Server replies |
|---|---|---|---|
| GET /api/lessons?courseId= | P own; S only lessons for own section | – | list; students also get `done` true/false |
| POST /api/lessons | P (teaches that course and sections) | title, courseId, desc, fileName, fileData, sectionIds[] | lesson |
| PUT / DELETE /api/lessons/{id} | P owner | same fields / – | lesson / `{}` |
| GET /api/lessons/{id}/file | P owner, S in section | – | `{fileName, fileData}` |
| POST / DELETE /api/lessons/{id}/done | S | – | `{}` (mark / unmark done) |

## 7. Assignments and submissions

| Call | Who | Browser sends | Server replies |
|---|---|---|---|
| GET /api/assignments?courseId= | P own; S own section | – | list; students also get `submitted` true/false |
| POST /api/assignments | P | title, courseId, desc, dueDate, points, attachmentName, attachmentType, attachmentData, sectionIds[] | assignment |
| PUT / DELETE /api/assignments/{id} | P owner | same fields / – | assignment / `{}` |
| GET /api/assignments/{id}/file | P owner, S in section | – | `{attachmentName, attachmentType, attachmentData}` |
| POST /api/assignments/{id}/submissions | S | note, fileName, fileData | submission. Sending again replaces it unless already graded (then 409) |
| GET /api/assignments/{id}/submissions | P owner all; S own only | – | list with studentName, status, grade, feedback, submittedAt |
| GET /api/submissions/{id}/file | P owner, S owner | – | `{fileName, fileData}` |
| PUT /api/submissions/{id}/grade | P owner | grade, feedback | submission (status graded) |

## 8. Quizzes and attempts

| Call | Who | Browser sends | Server replies |
|---|---|---|---|
| GET /api/quizzes?courseId= | P own (with answers); S own section (**without** correct answers and rubrics) | – | list with questions; students also get `attempted` true/false |
| POST /api/quizzes | P | title, courseId, dueDate, timeLimit, sectionIds[], questions[{type, text, points, optionA–D, correct, answer, rubric}] | quiz |
| PUT / DELETE /api/quizzes/{id} | P owner | same fields / – | quiz / `{}` |
| POST /api/quizzes/{id}/attempt | S | answers[{questionId, answer}] | attempt with auto-graded score so far (mcq and identification marked by the server; essays wait). A retake replaces the old attempt |
| GET /api/quizzes/{id}/attempts | P owner all; S own only | – | attempts with answers, pointsAwarded, feedback, total |
| PUT /api/attempts/{id}/grade | P owner | essays[{questionId, pointsAwarded, feedback}] | attempt with final total |

## 9. Grades and activity

| Call | Who | Browser sends | Server replies |
|---|---|---|---|
| GET /api/grades?courseId= | P students in own sections; S own only | – | per student: assignmentGrade, quizScore, finalGrade. Calculated on the spot with the same formula the front end uses today; nothing stored |
| GET /api/activity | A | – | newest 500 log entries (actor name, action, entity, time) |

## 10. Diff/sync approach (plain words)

Today the front end loads one big object (`cognitia_state`) and saves the whole thing back whenever something changes. To avoid rewriting every page, `api.js` keeps that habit but sends only what changed.

1. **Load.** After login, `api.js` calls the GET endpoints allowed for the user's role and builds the same-shaped in-memory state the pages already read. It keeps a second, untouched snapshot of it.
2. **Save = compare.** When page code calls save, `api.js` compares the state with the snapshot (the "diff"):
   - a record that is new → POST
   - a record that differs → PUT
   - a record that disappeared → DELETE
   
   Only those records are sent, one request each.
3. **Update the snapshot.** After each success, `api.js` swaps in the real id from the server and updates the snapshot. On failure it shows the error and reloads from the server, so the screen never keeps data the database rejected.
4. **Actions are not diffed.** Login, register, approve, mark done, submit, grade, quiz attempt: these are called directly, because the server computes things (scores, hashes, ids, timestamps). Only plain admin and professor edits (sections 3–8 create, edit, delete) go through the diff.
5. **Server is the truth.** Role checks and "is this your record" checks happen on the server, so a student editing the state in the browser changes nothing. If two people edit the same record, the last save wins. There is no merge.
6. **Refresh.** Pages reload their lists from the server when opened, so they see other people's changes.
