# Cognitia – Schema Notes

- **programs** – degree programs (BSCS...). Parent of sections; linked to courses and users.
- **sections** – a class group (program + year + letter). Belongs to one program. Label "BSCS 1A" is built from these columns.
- **courses** – subjects. Linked to programs and sections through the two tables below.
- **course_programs** – many-to-many courses ↔ programs, with the year level (replaces `programIds`, `programYears`).
- **section_courses** – which courses a section takes (replaces `section.courseIds`).
- **users** – admin, professor, student in one table (`role`). Student has program + section; `reviewed_by` points to the admin; password stored as a Java-generated hash.
- **teaching_assignments** – professor ↔ (section, course). Replaces `professorAssignments`, `sectionIds`, `courseIds`; it can only use a course the section really has.
- **announcements** – admin posts; `author_id` → users.
- **announcement_reads** – which user read which announcement (replaces `announcementReads`).
- **lessons** – professor's lesson for a course (file kept in `file_data`).
- **lesson_sections** – which sections can see a lesson (replaces the "BSCS 1A" text).
- **lesson_progress** – student marked a lesson done.
- **assignments** – professor's assignment for a course.
- **assignment_sections** – which sections receive the assignment.
- **submissions** – one per student per assignment, with grade and feedback; no stored copy.
- **quizzes** – professor's quiz for a course.
- **quiz_sections** – which sections receive the quiz.
- **quiz_questions** – questions of a quiz (mcq / identification / essay).
- **quiz_attempts** – one attempt per student per quiz (a retake replaces it).
- **quiz_answers** – each answer plus points and essay feedback; the score is the SUM of `points_awarded`.
- **activity_log** – admin audit trail; `actor_id` → users. Keep newest 500 in code.

## Left out on purpose
- **grades** table: assignment grade, quiz score and final grade can all be computed from `submissions` and `quiz_answers`. Add it back only if professors type a final grade by hand.
- **progress for assignments/quizzes**: "done" = a submission or attempt exists.
- Duplicated or derived columns: `displayName`, `joined`, student/course/section names in submissions and attempts, score percents, `quizzes.points` (sum of question points), the older `programId` on courses, the second copy in `cognitia_student_data`.
- Browser-only items stay in localStorage: session, theme, sidebar, terms flag, calendar ticks.
- `student_no` (starts 2026001) is generated in Java as MAX + 1.
