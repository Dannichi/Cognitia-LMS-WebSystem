package data;

// ============================================================================
// QuizData.java  (folder: backend/rcs/data/)
//
// Covers tables : quizzes, quiz_sections, quiz_questions,
//                 quiz_attempts, quiz_answers
// Used by       : QuizHandler
//                 (/api/quizzes..., /api/quizzes/{id}/attempt,
//                  /api/quizzes/{id}/attempts, /api/attempts/{id}/grade)
//
// Rules for this file:
//  - This is the ONLY place with SQL about quizzes.
//  - MARKING IS DONE HERE (on the server). A student never receives the correct
//    answers or rubrics: the student queries do not even select those columns.
//  - mcq and identification are marked automatically. Essays wait (points_awarded
//    stays NULL) until the professor grades them.
//  - EDIT RULE: a quiz that already has attempts can NOT be edited. The handler
//    calls hasAttempts(id) and answers 409. update() also refuses as a backstop.
//    (Deleting a quiz is always allowed.)
//  - A retake REPLACES the student's old attempt.
//  - Ownership checks are done by the HANDLER. This class gives it what it needs:
//      get(id).professorId, getAttempt(id).quizId / .studentId,
//      visibleToStudent(...), AcademicData.teachesSection(...)
//  - Bad input -> IllegalArgumentException (handler -> 400).
// ============================================================================

import util.Database;

import java.sql.Connection;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class QuizData {

    // Quiz columns sent to the browser.
    private static final String QUIZ_COLUMNS =
            "q.id, " +
            "q.course_id AS courseId, " +
            "q.professor_id AS professorId, " +
            "q.title, " +
            "q.due_date AS dueDate, " +
            "q.time_limit AS timeLimit, " +
            "q.created_at AS createdAt";

    // Question columns for the PROFESSOR: everything, including the answers.
    private static final String QUESTION_COLUMNS_FULL =
            "id, type, text, points, " +
            "option_a AS optionA, option_b AS optionB, option_c AS optionC, option_d AS optionD, " +
            "correct_option AS correct, answer, rubric";

    // Question columns for the STUDENT: NO correct, NO answer, NO rubric.
    private static final String QUESTION_COLUMNS_STUDENT =
            "id, type, text, points, " +
            "option_a AS optionA, option_b AS optionB, option_c AS optionC, option_d AS optionD";

    // ==================================================================
    // QUIZZES - READ
    // ==================================================================

    // GET /api/quizzes?courseId=   (courseId may be null = all courses)
    //   professor -> their own quizzes, WITH the answers
    //   student   -> quizzes for THEIR section, WITHOUT answers, each with "attempted" true/false
    public static List<Map<String, Object>> list(String role, long userId, Long courseId) {
        StringBuilder sql = new StringBuilder();
        List<Object> params = new ArrayList<>();
        boolean forStudent;

        if ("professor".equals(role)) {
            forStudent = false;
            sql.append("SELECT ").append(QUIZ_COLUMNS)
               .append(" FROM quizzes q WHERE q.professor_id = ?");
            params.add(userId);

        } else if ("student".equals(role)) {
            forStudent = true;
            // quizzes -> quiz_sections -> the student's own section.
            // LEFT JOIN quiz_attempts tells us if this student already attempted it.
            sql.append("SELECT ").append(QUIZ_COLUMNS).append(", qa.id AS attemptId")
               .append(" FROM quizzes q")
               .append(" JOIN quiz_sections qs ON qs.quiz_id = q.id")
               .append(" JOIN users u ON u.section_id = qs.section_id")
               .append(" LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id AND qa.student_id = u.id")
               .append(" WHERE u.id = ?");
            params.add(userId);

        } else {
            throw new IllegalArgumentException("Only professors and students have quizzes");
        }

        if (courseId != null) {
            sql.append(" AND q.course_id = ?");
            params.add(courseId);
        }
        sql.append(" ORDER BY q.created_at DESC, q.id DESC");

        List<Map<String, Object>> rows = Database.query(sql.toString(), params.toArray());

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(tidy(row, forStudent));
        }
        return result;
    }

    // One quiz in the PROFESSOR view (with answers) or null if not found.
    // The handler uses its "professorId" for the "is this your quiz?" check.
    // Never send this to a student.
    public static Map<String, Object> get(long id) {
        Map<String, Object> row = Database.queryOne(
                "SELECT " + QUIZ_COLUMNS + " FROM quizzes q WHERE q.id = ?", id);
        if (row == null) {
            return null;
        }
        return tidy(row, false);
    }

    // Adds "sectionIds" and "questions" to a quiz row.
    // forStudent = true  -> questions without answers, and "attemptId" becomes "attempted".
    private static Map<String, Object> tidy(Map<String, Object> row, boolean forStudent) {
        Map<String, Object> quiz = new LinkedHashMap<>(row); // copy so we can add keys
        long quizId = ((Number) row.get("id")).longValue();

        // sectionIds: [1, 2]
        List<Map<String, Object>> links = Database.query(
                "SELECT section_id AS sectionId FROM quiz_sections WHERE quiz_id = ? ORDER BY section_id",
                quizId);
        List<Object> sectionIds = new ArrayList<>();
        for (Map<String, Object> link : links) {
            sectionIds.add(link.get("sectionId"));
        }
        quiz.put("sectionIds", sectionIds);

        // questions: students get the safe column list, professors the full one
        String columns = forStudent ? QUESTION_COLUMNS_STUDENT : QUESTION_COLUMNS_FULL;
        quiz.put("questions", Database.query(
                "SELECT " + columns + " FROM quiz_questions WHERE quiz_id = ? ORDER BY id", quizId));

        // Only the student query has "attemptId"
        if (quiz.containsKey("attemptId")) {
            quiz.put("attempted", quiz.get("attemptId") != null);
            quiz.remove("attemptId");
        }
        return quiz;
    }

    // true if this quiz was given to the student's own section.
    public static boolean visibleToStudent(long quizId, long studentId) {
        Map<String, Object> row = Database.queryOne(
                "SELECT 1 AS found FROM quiz_sections qs " +
                "JOIN users u ON u.section_id = qs.section_id " +
                "WHERE qs.quiz_id = ? AND u.id = ? LIMIT 1",
                quizId, studentId);
        return row != null;
    }

    // true if at least one student already attempted this quiz.
    // The handler checks this before an edit and answers 409.
    public static boolean hasAttempts(long quizId) {
        Map<String, Object> row = Database.queryOne(
                "SELECT 1 AS found FROM quiz_attempts WHERE quiz_id = ? LIMIT 1", quizId);
        return row != null;
    }

    // ==================================================================
    // QUIZZES - CREATE / UPDATE / DELETE  (professor; handler checks ownership)
    // ==================================================================

    // POST /api/quizzes. professorId = the logged-in professor.
    // Quiz + section links + questions are saved in ONE transaction.
    // Returns the new quiz (professor view).
    public static Map<String, Object> create(long professorId, Map<String, Object> input) {
        // ---- validate and read the input BEFORE touching the database ----
        String title = text(input, "title");
        Integer courseId = number(input, "courseId");
        Integer timeLimit = number(input, "timeLimit");
        Timestamp dueDate = readDueDate(input);
        List<Long> sectionIds = idList(input.get("sectionIds"));
        List<Map<String, Object>> questions = mapList(input.get("questions"));

        checkQuizFields(title, courseId, timeLimit);
        if (sectionIds.isEmpty()) {
            throw new IllegalArgumentException("Choose at least one section");
        }
        checkQuestions(questions);

        // ---- transaction ----
        long newId = 0;
        Connection c = Database.begin();
        try {
            newId = Database.insert(c,
                    "INSERT INTO quizzes (course_id, professor_id, title, due_date, time_limit) " +
                    "VALUES (?, ?, ?, ?, ?)",
                    courseId, professorId, title, dueDate, timeLimit);

            saveSections(c, newId, sectionIds);
            saveQuestions(c, newId, questions);

            Database.commit(c);
        } catch (RuntimeException e) {
            Database.rollback(c);
            throw e;
        } finally {
            Database.close(c);
        }

        return get(newId);
    }

    // PUT /api/quizzes/{id}. Returns the updated quiz, or null if it does not exist.
    // Refuses (IllegalArgumentException) if the quiz already has attempts.
    // sectionIds and questions are replaced only when the key is sent; otherwise kept as is.
    // Note: replacing the questions gives them NEW ids (safe, because there are no attempts).
    public static Map<String, Object> update(long id, Map<String, Object> input) {
        if (get(id) == null) {
            return null;
        }
        if (hasAttempts(id)) {
            throw new IllegalArgumentException("This quiz already has attempts and can no longer be edited");
        }

        String title = text(input, "title");
        Integer courseId = number(input, "courseId");
        Integer timeLimit = number(input, "timeLimit");
        Timestamp dueDate = readDueDate(input);
        checkQuizFields(title, courseId, timeLimit);

        boolean replaceSections = input.containsKey("sectionIds");
        List<Long> sectionIds = idList(input.get("sectionIds"));
        if (replaceSections && sectionIds.isEmpty()) {
            throw new IllegalArgumentException("Choose at least one section");
        }

        boolean replaceQuestions = input.containsKey("questions");
        List<Map<String, Object>> questions = mapList(input.get("questions"));
        if (replaceQuestions) {
            checkQuestions(questions);
        }

        // ---- transaction ----
        Connection c = Database.begin();
        try {
            Database.update(c,
                    "UPDATE quizzes SET course_id = ?, title = ?, due_date = ?, time_limit = ? WHERE id = ?",
                    courseId, title, dueDate, timeLimit, id);

            if (replaceSections) {
                Database.update(c, "DELETE FROM quiz_sections WHERE quiz_id = ?", id);
                saveSections(c, id, sectionIds);
            }
            if (replaceQuestions) {
                Database.update(c, "DELETE FROM quiz_questions WHERE quiz_id = ?", id);
                saveQuestions(c, id, questions);
            }

            Database.commit(c);
        } catch (RuntimeException e) {
            Database.rollback(c);
            throw e;
        } finally {
            Database.close(c);
        }

        return get(id);
    }

    // DELETE /api/quizzes/{id}. Returns rows deleted (0 = not found).
    // Sections, questions, attempts and answers go away by cascade.
    public static int delete(long id) {
        return Database.update("DELETE FROM quizzes WHERE id = ?", id);
    }

    // Checks the plain quiz fields.
    private static void checkQuizFields(String title, Integer courseId, Integer timeLimit) {
        if (title == null || courseId == null) {
            throw new IllegalArgumentException("title and courseId are required");
        }
        if (title.length() > 200) {
            throw new IllegalArgumentException("title is too long (max 200 characters)");
        }
        if (timeLimit != null && timeLimit < 1) {
            throw new IllegalArgumentException("timeLimit must be at least 1 minute");
        }
    }

    // Checks every question BEFORE anything is saved.
    //   mcq            -> four options + a correct letter A-D
    //   identification -> an answer
    //   essay          -> nothing extra (rubric is optional)
    private static void checkQuestions(List<Map<String, Object>> questions) {
        if (questions.isEmpty()) {
            throw new IllegalArgumentException("Add at least one question");
        }

        for (Map<String, Object> q : questions) {
            String type = text(q, "type");
            String questionText = text(q, "text");
            Integer points = number(q, "points");

            if (type == null || questionText == null) {
                throw new IllegalArgumentException("Every question needs a type and a text");
            }
            if (!type.equals("mcq") && !type.equals("identification") && !type.equals("essay")) {
                throw new IllegalArgumentException("Question type must be mcq, identification or essay");
            }
            if (points != null && points < 1) {
                throw new IllegalArgumentException("Question points must be at least 1");
            }

            if (type.equals("mcq")) {
                String[] keys = {"optionA", "optionB", "optionC", "optionD"};
                for (String key : keys) {
                    String option = text(q, key);
                    if (option == null) {
                        throw new IllegalArgumentException("A multiple choice question needs optionA to optionD");
                    }
                    if (option.length() > 255) {
                        throw new IllegalArgumentException(key + " is too long (max 255 characters)");
                    }
                }
                String correct = text(q, "correct");
                if (correct == null || !"ABCD".contains(correct.toUpperCase()) || correct.length() != 1) {
                    throw new IllegalArgumentException("correct must be A, B, C or D");
                }
            }

            if (type.equals("identification")) {
                String answer = text(q, "answer");
                if (answer == null) {
                    throw new IllegalArgumentException("An identification question needs an answer");
                }
                if (answer.length() > 255) {
                    throw new IllegalArgumentException("answer is too long (max 255 characters)");
                }
            }
        }
    }

    // Inserts the rows of quiz_sections. Link tables have no auto id,
    // so we use Database.update, not insert.
    private static void saveSections(Connection c, long quizId, List<Long> sectionIds) {
        for (Long sectionId : sectionIds) {
            Database.update(c,
                    "INSERT INTO quiz_sections (quiz_id, section_id) VALUES (?, ?)",
                    quizId, sectionId);
        }
    }

    // Inserts the questions (already checked by checkQuestions).
    // Only the columns that belong to the question type are filled; the rest stay NULL.
    private static void saveQuestions(Connection c, long quizId, List<Map<String, Object>> questions) {
        for (Map<String, Object> q : questions) {
            String type = text(q, "type");
            Integer points = number(q, "points");
            if (points == null) {
                points = 1; // same default as the table
            }

            String optionA = null, optionB = null, optionC = null, optionD = null;
            String correct = null, answer = null, rubric = null;

            if (type.equals("mcq")) {
                optionA = text(q, "optionA");
                optionB = text(q, "optionB");
                optionC = text(q, "optionC");
                optionD = text(q, "optionD");
                correct = text(q, "correct").toUpperCase();
            } else if (type.equals("identification")) {
                answer = text(q, "answer");
            } else {
                rubric = text(q, "rubric"); // essay
            }

            Database.update(c,
                    "INSERT INTO quiz_questions (quiz_id, type, text, points, option_a, option_b, " +
                    "option_c, option_d, correct_option, answer, rubric) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    quizId, type, text(q, "text"), points, optionA, optionB,
                    optionC, optionD, correct, answer, rubric);
        }
    }

    // ==================================================================
    // ATTEMPTS - STUDENT SUBMITS (server marks)
    // ==================================================================

    // POST /api/quizzes/{id}/attempt (student).
    // The handler first checks the quiz exists and visibleToStudent(...).
    // input: answers = [{questionId, answer}]
    //   mcq            -> correct when the letter matches (A-D, ignoring upper/lower case)
    //   identification -> correct when the text matches (ignoring upper/lower case and spaces around)
    //   essay          -> points stay NULL until the professor grades it
    // A question the student did not answer gets 0 points (essays stay NULL).
    // A retake REPLACES the old attempt. Returns the attempt with the score so far.
    public static Map<String, Object> submitAttempt(long quizId, long studentId, Map<String, Object> input) {
        // ---- the real questions of this quiz (with the correct answers) ----
        List<Map<String, Object>> questions = Database.query(
                "SELECT id, type, points, correct_option AS correct, answer " +
                "FROM quiz_questions WHERE quiz_id = ? ORDER BY id",
                quizId);

        // ---- the student's answers, as a map: questionId -> answer text ----
        Map<Long, String> given = new HashMap<>();
        for (Map<String, Object> a : mapList(input.get("answers"))) {
            Integer questionId = number(a, "questionId");
            if (questionId == null) {
                throw new IllegalArgumentException("Every answer needs a questionId");
            }
            given.put(questionId.longValue(), text(a, "answer"));
        }

        // Every answered questionId must belong to THIS quiz.
        for (Long answeredId : given.keySet()) {
            boolean found = false;
            for (Map<String, Object> q : questions) {
                if (((Number) q.get("id")).longValue() == answeredId) {
                    found = true;
                }
            }
            if (!found) {
                throw new IllegalArgumentException("questionId " + answeredId + " is not in this quiz");
            }
        }

        // ---- transaction: remove the old attempt, save the new one with its marks ----
        long attemptId = 0;
        Connection c = Database.begin();
        try {
            // retake replaces the old attempt (its answers go away by cascade)
            Database.update(c,
                    "DELETE FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?",
                    quizId, studentId);

            attemptId = Database.insert(c,
                    "INSERT INTO quiz_attempts (quiz_id, student_id) VALUES (?, ?)",
                    quizId, studentId);

            for (Map<String, Object> q : questions) {
                long questionId = ((Number) q.get("id")).longValue();
                String type = (String) q.get("type");
                int points = ((Number) q.get("points")).intValue();
                String studentAnswer = given.get(questionId);

                // ---- marking ----
                Integer awarded; // null = waiting for the professor (essay)
                if (type.equals("mcq")) {
                    boolean right = studentAnswer != null
                            && studentAnswer.equalsIgnoreCase((String) q.get("correct"));
                    awarded = right ? points : 0;
                } else if (type.equals("identification")) {
                    boolean right = studentAnswer != null
                            && studentAnswer.equalsIgnoreCase((String) q.get("answer"));
                    awarded = right ? points : 0;
                } else {
                    awarded = null; // essay
                }

                Database.update(c,
                        "INSERT INTO quiz_answers (attempt_id, question_id, answer, points_awarded) " +
                        "VALUES (?, ?, ?, ?)",
                        attemptId, questionId, studentAnswer, awarded);
            }

            Database.commit(c);
        } catch (RuntimeException e) {
            Database.rollback(c);
            throw e;
        } finally {
            Database.close(c);
        }

        return getAttempt(attemptId);
    }

    // ==================================================================
    // ATTEMPTS - READ
    // ==================================================================

    // GET /api/quizzes/{id}/attempts
    // studentId = null     -> every attempt of the quiz (professor)
    // studentId = a number -> only that student's attempt (student sees own only)
    public static List<Map<String, Object>> listAttempts(long quizId, Long studentId) {
        StringBuilder sql = new StringBuilder(ATTEMPT_SELECT);
        sql.append("WHERE qa.quiz_id = ?");
        List<Object> params = new ArrayList<>();
        params.add(quizId);

        if (studentId != null) {
            sql.append(" AND qa.student_id = ?");
            params.add(studentId);
        }
        sql.append(" ORDER BY u.last_name, u.first_name");

        List<Map<String, Object>> rows = Database.query(sql.toString(), params.toArray());

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(buildAttempt(row));
        }
        return result;
    }

    // One attempt or null if not found.
    // The handler uses "quizId" (then get(quizId).professorId for the professor check).
    public static Map<String, Object> getAttempt(long attemptId) {
        Map<String, Object> row = Database.queryOne(ATTEMPT_SELECT + "WHERE qa.id = ?", attemptId);
        if (row == null) {
            return null;
        }
        return buildAttempt(row);
    }

    private static final String ATTEMPT_SELECT =
            "SELECT qa.id, " +
            "qa.quiz_id AS quizId, " +
            "qa.student_id AS studentId, " +
            "CONCAT(u.first_name, ' ', u.last_name) AS studentName, " +
            "qa.attempted_at AS attemptedAt " +
            "FROM quiz_attempts qa JOIN users u ON u.id = qa.student_id ";

    // Adds to an attempt row:
    //   answers   : [{questionId, answer, pointsAwarded, feedback}]
    //               (pointsAwarded is null while an essay is waiting)
    //   total     : points awarded so far (waiting essays count as 0)
    //   maxPoints : the quiz's total possible points
    private static Map<String, Object> buildAttempt(Map<String, Object> row) {
        Map<String, Object> attempt = new LinkedHashMap<>(row);
        long attemptId = ((Number) row.get("id")).longValue();
        long quizId = ((Number) row.get("quizId")).longValue();

        List<Map<String, Object>> answerRows = Database.query(
                "SELECT question_id AS questionId, answer, points_awarded AS pointsAwarded, feedback " +
                "FROM quiz_answers WHERE attempt_id = ? ORDER BY question_id",
                attemptId);

        List<Map<String, Object>> answers = new ArrayList<>();
        double total = 0;
        for (Map<String, Object> answerRow : answerRows) {
            Map<String, Object> a = new LinkedHashMap<>(answerRow);
            Object awarded = a.get("pointsAwarded");
            if (awarded instanceof Number) {
                double value = ((Number) awarded).doubleValue(); // DECIMAL -> plain number
                a.put("pointsAwarded", value);
                total = total + value;
            }
            answers.add(a);
        }
        attempt.put("answers", answers);
        attempt.put("total", total);

        Map<String, Object> max = Database.queryOne(
                "SELECT COALESCE(SUM(points), 0) AS maxPoints FROM quiz_questions WHERE quiz_id = ?",
                quizId);
        attempt.put("maxPoints", ((Number) max.get("maxPoints")).intValue());

        return attempt;
    }

    // ==================================================================
    // ATTEMPTS - PROFESSOR GRADES THE ESSAYS
    // ==================================================================

    // PUT /api/attempts/{id}/grade (professor; the handler checked ownership).
    // input: essays = [{questionId, pointsAwarded, feedback}]
    // Each questionId must be an ESSAY question of this attempt's quiz, and
    // pointsAwarded must be between 0 and that question's points.
    // Everything is saved in one transaction. Returns the attempt with the new total,
    // or null if the attempt does not exist.
    public static Map<String, Object> gradeAttempt(long attemptId, Map<String, Object> input) {
        Map<String, Object> attempt = getAttempt(attemptId);
        if (attempt == null) {
            return null;
        }
        long quizId = ((Number) attempt.get("quizId")).longValue();

        List<Map<String, Object>> essays = mapList(input.get("essays"));
        if (essays.isEmpty()) {
            throw new IllegalArgumentException("essays is required");
        }

        // Points of each essay question of this quiz: questionId -> points
        Map<Long, Integer> essayPoints = new HashMap<>();
        List<Map<String, Object>> essayQuestions = Database.query(
                "SELECT id, points FROM quiz_questions WHERE quiz_id = ? AND type = 'essay'", quizId);
        for (Map<String, Object> q : essayQuestions) {
            essayPoints.put(((Number) q.get("id")).longValue(), ((Number) q.get("points")).intValue());
        }

        // ---- check everything BEFORE saving anything ----
        for (Map<String, Object> e : essays) {
            Integer questionId = number(e, "questionId");
            Double awarded = decimal(e, "pointsAwarded");
            if (questionId == null || awarded == null) {
                throw new IllegalArgumentException("Every essay needs questionId and pointsAwarded");
            }
            Integer maxPoints = essayPoints.get(questionId.longValue());
            if (maxPoints == null) {
                throw new IllegalArgumentException("questionId " + questionId + " is not an essay of this quiz");
            }
            if (awarded < 0 || awarded > maxPoints) {
                throw new IllegalArgumentException(
                        "pointsAwarded for question " + questionId + " must be between 0 and " + maxPoints);
            }
        }

        // ---- transaction ----
        Connection c = Database.begin();
        try {
            for (Map<String, Object> e : essays) {
                Database.update(c,
                        "UPDATE quiz_answers SET points_awarded = ?, feedback = ? " +
                        "WHERE attempt_id = ? AND question_id = ?",
                        decimal(e, "pointsAwarded"), text(e, "feedback"),
                        attemptId, number(e, "questionId"));
            }
            Database.commit(c);
        } catch (RuntimeException ex) {
            Database.rollback(c);
            throw ex;
        } finally {
            Database.close(c);
        }

        return getAttempt(attemptId);
    }

    // ==================================================================
    // Small private helpers (only used inside this file)
    // ==================================================================

    // Reads "dueDate" (optional). A plain 2026-10-20 becomes 2026-10-20 00:00:00.
    private static Timestamp readDueDate(Map<String, Object> input) {
        String dueText = text(input, "dueDate");
        if (dueText == null) {
            return null;
        }
        if (dueText.length() == 10) {
            dueText = dueText + "T00:00:00";
        }
        try {
            return Database.toTimestamp(dueText);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("dueDate is not a valid date");
        }
    }

    // Text value from the input. Returns null when missing or blank.
    private static String text(Map<String, Object> input, String key) {
        Object value = input.get(key);
        if (value == null) {
            return null;
        }
        String s = value.toString().trim();
        return s.isEmpty() ? null : s;
    }

    // Whole number from the input (JSON numbers arrive as Long). null when missing.
    private static Integer number(Map<String, Object> input, String key) {
        Object value = input.get(key);
        if (value == null) {
            return null;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        try {
            return Integer.parseInt(value.toString().trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(key + " must be a number");
        }
    }

    // Number with decimals from the input (like 7.5). null when missing.
    private static Double decimal(Map<String, Object> input, String key) {
        Object value = input.get(key);
        if (value == null) {
            return null;
        }
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        try {
            return Double.parseDouble(value.toString().trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(key + " must be a number");
        }
    }

    // JSON list of numbers -> List<Long>. Missing -> empty list. Repeated ids kept once.
    private static List<Long> idList(Object value) {
        List<Long> result = new ArrayList<>();
        if (value == null) {
            return result;
        }
        if (!(value instanceof List)) {
            throw new IllegalArgumentException("Expected a list of ids");
        }
        for (Object item : (List<?>) value) {
            if (!(item instanceof Number)) {
                throw new IllegalArgumentException("Ids must be numbers");
            }
            Long id = ((Number) item).longValue();
            if (!result.contains(id)) {
                result.add(id);
            }
        }
        return result;
    }

    // JSON list of objects -> List of Maps. Missing -> empty list.
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> mapList(Object value) {
        List<Map<String, Object>> result = new ArrayList<>();
        if (value == null) {
            return result;
        }
        if (!(value instanceof List)) {
            throw new IllegalArgumentException("Expected a list");
        }
        for (Object item : (List<Object>) value) {
            if (!(item instanceof Map)) {
                throw new IllegalArgumentException("Expected a list of objects");
            }
            result.add((Map<String, Object>) item);
        }
        return result;
    }
}
