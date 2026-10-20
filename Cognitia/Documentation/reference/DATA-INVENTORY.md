# Cognitia – Data Inventory

Source: the front-end zip (`Cognitia/Frontend`). Everything is saved in the browser's localStorage. There is no `js/api.js` in the zip yet.

Most records live in one big JSON object under the key `cognitia_state`. That object holds these lists: `users`, `programs`, `sections`, `courses`, `announcements`, `lessons`, `assignments`, `quizzes`, `grades`, `activities`, plus `announcementReads` and a counter `nextId`.

---

## 1. Records

### User (admin, professor, student share one list)
- **Fields:** id, firstname, middlename, lastname, displayName, email, phone (self-registered only, "+63…"), password (plain text), role (admin / professor / student), studentId (students only, starts at 2026001), programId, sectionId (student), sectionIds[] (professor), courseIds[] (professor), status (active / inactive), approvalStatus (pending / approved / rejected), registeredAt, joined, reviewedAt, reviewedBy.
- **Created by:** register.js (self-registration, starts as pending), admin.js (add user, "generate test students"), login.js (seeds one admin account if none exists).
- **Read by:** login.js, session.js (route guard), admin.js, approval.js, student.js and professor.js (own profile; professor.js loads all students), notification.js (role decides which announcements show).
- **Saved by:** register.js, admin.js, login.js, approval.js (sets approvalStatus, status, reviewedAt, reviewedBy).
- **Relations:** belongs to a program and (student) a section; a professor has many sections and courses; reviewedBy points to the admin user.

### Program
- **Fields:** id, name, code (e.g. BSCS), desc, status, color, catalogId, department, departmentId, campusId.
- **Created by:** admin. Chosen from the fixed catalog in academic-config.js.
- **Read by:** admin, student.js and professor.js (to build labels like "BSCS 1A").
- **Saved by:** admin.js.
- **Relations:** has many sections, users, and courses (courses list programIds).

### Section
- **Fields:** id, programId, year, letter, capacity, courseIds[], professorAssignments[ {professorId, courseIds[]} ].
- **Created by:** admin. Professor assignment is also done by admin.
- **Read by:** admin, student.js (own section label), professor.js (own sections).
- **Saved by:** admin.js.
- **Relations:** belongs to one program; has many students (user.sectionId); links professors to courses.

### Course
- **Fields:** id, name, code, programIds[], programId (older single-program field), programYears (per program, which years), year, semester, units, status (Active / other).
- **Created by:** admin.
- **Read by:** admin; student.js (active courses whose programIds include the student's program); professor.js (courses in the professor's courseIds).
- **Saved by:** admin.js.
- **Relations:** many-to-many with programs and sections; lessons, assignments, quizzes and grades point to it by courseId.

### Announcement
- **Fields:** id, title, body, type, category, audience (all / students / professors), featured, status (draft / scheduled / published), date, createdAt, publishedAt, scheduledDate, eventDate, authorId.
- **Created by:** admin.
- **Read by:** all roles (dashboards, bulletin-reader.js, topbar.js, notification.js).
- **Saved by:** admin.js.
- **Relations:** authorId points to a user.

### Lesson
- **Fields:** id, title, courseId, section (text label like "BSCS 1A"), programSections[ {label} ], desc, fileName, fileData (the file itself as text), professorId, createdAt.
- **Created by:** professor.
- **Read by:** the professor who made it; students in that course whose section label matches.
- **Saved by:** professor.js.
- **Relations:** course, professor.

### Assignment
- **Fields:** id, title, courseId, section, programSections, desc, dueDate, points, attachmentName, attachmentData, attachmentType, professorId, createdAt, submissions[].
- **Created by:** professor.
- **Read by:** the professor; matching students.
- **Saved by:** professor.js.
- **Relations:** course, professor; contains its submissions.

### Submission (stored inside its assignment)
- **Fields:** id, assignmentId, studentId, studentName, section, sectionId, courseId, course, title, note/content, fileName, fileData, status (submitted / graded), submittedAt, grade, feedback, gradedAt.
- **Created by:** student. **Graded by:** professor.
- **Read by:** both. **Saved by:** student.js (create), professor.js (grade).
- **Relations:** assignment, student, course. A copy is also kept in `cognitia_student_data`.

### Quiz
- **Fields:** id, title, courseId, section, programSections, points, dueDate, timeLimit, professorId, createdAt, questions[], attempts[].
- **Question fields:** type (mcq / identification / essay), text, points, plus options A–D and correct (mcq), answer (identification), or rubric (essay).
- **Created by:** professor. **Read by:** the professor; matching students.
- **Saved by:** professor.js.

### Quiz attempt (stored inside its quiz)
- **Fields:** studentId, studentName, section, sectionId, courseId, answers, score, scorePercent, attemptedAt, essayGrades, essayFeedback, finalScore, finalScorePercent.
- **Created by:** student (retaking overwrites the earlier attempt). **Essay scoring by:** professor.
- **Saved by:** student.js, professor.js.
- **Relations:** quiz, student. A copy (quizResults: id, quizId, studentId, answers, score, scorePercent, attemptedAt) is kept in `cognitia_student_data`.

### Grade (one per student per course)
- **Fields:** id, studentId, courseId, professorId, assignmentGrade, quizScore, finalGrade, updatedAt.
- **Created by:** professor.js when grading; student.js when a quiz is submitted.
- **Read by:** professor. The student's grade page recalculates from submissions and attempts.
- **Saved by:** professor.js, student.js (also copied into `cognitia_student_data`).

### Progress ("marked done")
- **Fields:** studentId, courseId, type (lesson / assignment / quiz), itemId, key, doneAt.
- **Created, read and saved by:** student.js, in `cognitia_student_data`.

### Activity log entry
- **Fields:** id, type, entityType (user / program / section / course / announcement), action, entityId, entityLabel, description, details, actor {id, name, role}, timestamp. Newest 500 are kept.
- **Created by:** activity.js, called after admin actions and registration. **Read by:** admin.

### Announcement read marks
- **Fields:** `announcementReads` = { userId: [announcementIds] }.
- **Saved and read by:** notification.js.

### Session
- **Fields:** a copy of the logged-in user without the password.
- **Saved by:** session.js and login.js; refreshed by student.js and professor.js.

---

## 2. localStorage keys

- `cognitia_state` – main object (lists above, plus `nextId` shared by admin-created records).
- `cognitia_student_data` – progress, submissions, quizResults, grades (student copies).
- `cognitia_prof_data` – older key; professor.js only copies it into `cognitia_state`.
- `cognitia_current_user` – session.
- `cognitia_next_student_id` – student ID counter.
- `cognitia_terms_read` – "true" once terms are accepted.
- `cognitia_cal_done:<userId>`, `cognitia_cal_deleted:<userId>` – calendar items a student ticked off or removed.
- `cognitia_sidebar_<role>` (and `_small`) – sidebar collapsed or expanded.
- `cognitia-theme` – light or dark.

## 3. Not saved at all
- Calendar events (sample events plus ones added in memory; lost on reload).
- Announcement media (preview only).
- The program, year and section catalog (fixed in academic-config.js).

## 4. Things noticed
- Submissions, quiz attempts and grades are stored twice (`cognitia_state` and `cognitia_student_data`).
- There is no enrollment record. A student's courses come from matching program.
- Lessons, assignments and quizzes store the section as text ("BSCS 1A"), not a section id.
- IDs come from different sources: a shared counter (admin records), Date.now() (professor and student records), text (activity). courseIds appear as both numbers and strings.
- Passwords are plain text. Files are stored inside records as text.
