package handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import data.AcademicData;
import data.QuizData;
import util.Auth;
import util.Database;
import util.Reply;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * QuizHandler:
 *   /api/quizzes, /api/quizzes/{id}, /api/quizzes/{id}/attempt,
 *   /api/quizzes/{id}/attempts, /api/attempts/{id}/grade
 * Tables used (through QuizData / AcademicData): quizzes, quiz_sections, quiz_questions,
 * quiz_attempts, quiz_answers.
 * Main must register this handler on "/api/quizzes" AND "/api/attempts".
 * Quizzes are not written to the activity log.
 */
public class QuizHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws IOException {
        // Step 1: CORS preflight
        if (Reply.handlePreflight(ex)) return;

        try {
            String method = ex.getRequestMethod();
            // "/api/quizzes/7/attempt" -> ["quizzes","7","attempt"]
            String[] parts = ex.getRequestURI().getPath().substring(5).split("/");

            // Step 3: route by first part, number of parts and method
            if (parts[0].equals("quizzes")) {
                if (parts.length == 1 && method.equals("GET")) {
                    list(ex);
                } else if (parts.length == 1 && method.equals("POST")) {
                    create(ex);
                } else if (parts.length == 2 && method.equals("PUT")) {
                    update(ex, parseId(parts[1]));
                } else if (parts.length == 2 && method.equals("DELETE")) {
                    delete(ex, parseId(parts[1]));
                } else if (parts.length == 3 && parts[2].equals("attempt") && method.equals("POST")) {
                    attempt(ex, parseId(parts[1]));
                } else if (parts.length == 3 && parts[2].equals("attempts") && method.equals("GET")) {
                    listAttempts(ex, parseId(parts[1]));
                } else {
                    Reply.error(ex, 404, "Not found");
                }
            } else if (parts[0].equals("attempts")) {
                if (parts.length == 3 && parts[2].equals("grade") && method.equals("PUT")) {
                    gradeAttempt(ex, parseId(parts[1]));
                } else {
                    Reply.error(ex, 404, "Not found");
                }
            } else {
                Reply.error(ex, 404, "Not found");
            }
        } catch (Exception e) {
            fail(ex, e);
        }
    }

    // GET /api/quizzes?courseId=
    // Professor: own quizzes WITH answers. Student: own section, WITHOUT answers.
    // (The data class removes the answers for students.)
    private void list(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "professor", "student");
        if (session == null) return;

        Long courseId = courseIdParam(ex);
        Reply.ok(ex, QuizData.list(session.role, session.userId, courseId));
    }

    // POST /api/quizzes (professor who teaches that course and those sections)
    private void create(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "professor");
        if (session == null) return;

        Map<String, Object> body = Reply.readJson(ex);
        Object course = body.get("courseId");
        if (!(course instanceof Number)) {
            Reply.error(ex, 400, "courseId is required");
            return;
        }
        long courseId = ((Number) course).longValue();

        // Step 4: ownership check
        if (!checkTeaching(ex, session, courseId, body.get("sectionIds"))) return;

        Reply.ok(ex, QuizData.create(session.userId, body));
    }

    // PUT /api/quizzes/{id} (professor owner). Not allowed once someone has attempted it.
    private void update(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "professor");
        if (session == null) return;

        Map<String, Object> quiz = loadOwned(ex, session, id);
        if (quiz == null) return;   // 404 or 403 already sent

        if (QuizData.hasAttempts(id)) {
            Reply.error(ex, 409, "This quiz already has attempts and cannot be edited");
            return;
        }

        Map<String, Object> body = Reply.readJson(ex);

        // If the body does not send a courseId, the quiz keeps its old course
        Object course = body.get("courseId");
        long courseId = (course instanceof Number)
                ? ((Number) course).longValue()
                : ((Number) quiz.get("courseId")).longValue();

        if (!checkTeaching(ex, session, courseId, body.get("sectionIds"))) return;

        Map<String, Object> saved = QuizData.update(id, body);
        if (saved == null) {
            Reply.error(ex, 404, "Quiz not found");
            return;
        }
        Reply.ok(ex, saved);
    }

    // DELETE /api/quizzes/{id} (professor owner). Always allowed.
    private void delete(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "professor");
        if (session == null) return;

        if (loadOwned(ex, session, id) == null) return;

        int rows = QuizData.delete(id);
        if (rows == 0) {
            Reply.error(ex, 404, "Quiz not found");
            return;
        }
        Reply.ok(ex, Map.of());
    }

    // POST /api/quizzes/{id}/attempt (student). A retake replaces the old attempt.
    private void attempt(HttpExchange ex, long quizId) throws IOException {
        Auth.Session session = Auth.check(ex, "student");
        if (session == null) return;

        if (!QuizData.visibleToStudent(quizId, session.userId)) {
            Reply.error(ex, 403, "This quiz is not for you");
            return;
        }

        Map<String, Object> body = Reply.readJson(ex);
        // The server marks mcq and identification. Essays wait for the professor.
        Reply.ok(ex, QuizData.submitAttempt(quizId, session.userId, body));
    }

    // GET /api/quizzes/{id}/attempts (professor owner: all, student: own only)
    private void listAttempts(HttpExchange ex, long quizId) throws IOException {
        Auth.Session session = Auth.check(ex, "professor", "student");
        if (session == null) return;

        if (session.role.equals("professor")) {
            if (loadOwned(ex, session, quizId) == null) return;
            Reply.ok(ex, QuizData.listAttempts(quizId, null));   // null = all students
        } else {
            if (!QuizData.visibleToStudent(quizId, session.userId)) {
                Reply.error(ex, 403, "This quiz is not for you");
                return;
            }
            // A student always passes their OWN id, so they only see their own attempt
            Reply.ok(ex, QuizData.listAttempts(quizId, session.userId));
        }
    }

    // PUT /api/attempts/{id}/grade (professor owner of the quiz). Grades the essays.
    private void gradeAttempt(HttpExchange ex, long attemptId) throws IOException {
        Auth.Session session = Auth.check(ex, "professor");
        if (session == null) return;

        Map<String, Object> attempt = QuizData.getAttempt(attemptId);
        if (attempt == null) {
            Reply.error(ex, 404, "Attempt not found");
            return;
        }
        // attempt -> quiz -> professor
        long quizId = ((Number) attempt.get("quizId")).longValue();
        if (loadOwned(ex, session, quizId) == null) return;

        Map<String, Object> body = Reply.readJson(ex);
        Map<String, Object> graded = QuizData.gradeAttempt(attemptId, body);
        if (graded == null) {
            Reply.error(ex, 404, "Attempt not found");
            return;
        }
        Reply.ok(ex, graded);
    }

    // ----------------------------------------------------------------- helpers

    // Load a quiz and make sure it belongs to this professor.
    // Sends 404 or 403 and returns null when it does not.
    // (QuizData.get shows answers, so its result is only used here, never sent to a student.)
    private static Map<String, Object> loadOwned(HttpExchange ex, Auth.Session session, long id)
            throws IOException {
        Map<String, Object> quiz = QuizData.get(id);
        if (quiz == null) {
            Reply.error(ex, 404, "Quiz not found");
            return null;
        }
        long owner = ((Number) quiz.get("professorId")).longValue();
        if (owner != session.userId) {
            Reply.error(ex, 403, "This is not your quiz");
            return null;
        }
        return quiz;
    }

    // The professor must teach the course, and each chosen section of that course.
    // Sends 400 or 403 and returns false when not.
    private static boolean checkTeaching(HttpExchange ex, Auth.Session session,
                                         long courseId, Object sectionIds) throws IOException {
        if (!AcademicData.teachesCourse(session.userId, courseId)) {
            Reply.error(ex, 403, "You do not teach that course");
            return false;
        }
        if (sectionIds instanceof List) {
            for (Object item : (List<?>) sectionIds) {
                if (!(item instanceof Number)) {
                    Reply.error(ex, 400, "sectionIds must be numbers");
                    return false;
                }
                long sectionId = ((Number) item).longValue();
                if (!AcademicData.teachesSection(session.userId, courseId, sectionId)) {
                    Reply.error(ex, 403, "You do not teach that course in that section");
                    return false;
                }
            }
        }
        return true;
    }

    // Optional ?courseId= . Missing or empty -> null (no filter).
    private static Long courseIdParam(HttpExchange ex) {
        String text = Reply.queryParam(ex, "courseId");
        if (text == null || text.isEmpty()) return null;
        return parseId(text);
    }

    // Text -> number. A bad number becomes a 400 error.
    private static long parseId(String text) {
        try {
            return Long.parseLong(text);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Bad number in the request");
        }
    }

    // Turn an exception into the right error reply (the agreed error mapping).
    private static void fail(HttpExchange ex, Exception e) throws IOException {
        if (e instanceof IllegalArgumentException) {
            Reply.error(ex, 400, e.getMessage());
        } else if (Database.isDuplicate(e)) {
            Reply.error(ex, 409, "That record already exists");
        } else if (Database.isForeignKeyError(e)) {
            Reply.error(ex, 400, "That record is linked to other data");
        } else {
            Reply.error(ex, 500, "Server error");
        }
    }
}
