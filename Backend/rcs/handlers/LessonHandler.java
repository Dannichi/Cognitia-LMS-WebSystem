package handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import data.AcademicData;
import data.LessonData;
import util.Auth;
import util.Database;
import util.Reply;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * LessonHandler: /api/lessons, /api/lessons/{id}, /api/lessons/{id}/file,
 * /api/lessons/{id}/done
 * Tables used (through LessonData / AcademicData): lessons, lesson_sections, lesson_progress.
 * Main must register this handler on "/api/lessons". Lessons are not written to the activity log.
 */
public class LessonHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws IOException {
        // Step 1: CORS preflight
        if (Reply.handlePreflight(ex)) return;

        try {
            String method = ex.getRequestMethod();
            // "/api/lessons/7/file" -> ["lessons","7","file"]
            String[] parts = ex.getRequestURI().getPath().substring(5).split("/");

            // Step 3: route by number of path parts + method
            if (parts.length == 1 && method.equals("GET")) {
                list(ex);
            } else if (parts.length == 1 && method.equals("POST")) {
                create(ex);
            } else if (parts.length == 2 && method.equals("PUT")) {
                update(ex, parseId(parts[1]));
            } else if (parts.length == 2 && method.equals("DELETE")) {
                delete(ex, parseId(parts[1]));
            } else if (parts.length == 3 && parts[2].equals("file") && method.equals("GET")) {
                file(ex, parseId(parts[1]));
            } else if (parts.length == 3 && parts[2].equals("done")
                    && (method.equals("POST") || method.equals("DELETE"))) {
                done(ex, parseId(parts[1]), method.equals("POST"));
            } else {
                Reply.error(ex, 404, "Not found");
            }
        } catch (Exception e) {
            fail(ex, e);
        }
    }

    // GET /api/lessons?courseId=  (professor: own lessons, student: lessons of own section)
    private void list(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "professor", "student");
        if (session == null) return;

        Long courseId = courseIdParam(ex);
        Reply.ok(ex, LessonData.list(session.role, session.userId, courseId));
    }

    // POST /api/lessons (professor who teaches that course and those sections)
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

        Reply.ok(ex, LessonData.create(session.userId, body));
    }

    // PUT /api/lessons/{id} (professor owner)
    private void update(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "professor");
        if (session == null) return;

        Map<String, Object> lesson = loadOwned(ex, session, id);
        if (lesson == null) return;   // 404 or 403 already sent

        Map<String, Object> body = Reply.readJson(ex);

        // If the body does not send a courseId, the lesson keeps its old course
        Object course = body.get("courseId");
        long courseId = (course instanceof Number)
                ? ((Number) course).longValue()
                : ((Number) lesson.get("courseId")).longValue();

        // sectionIds is only checked when the body sends it
        if (!checkTeaching(ex, session, courseId, body.get("sectionIds"))) return;

        Map<String, Object> saved = LessonData.update(id, body);
        if (saved == null) {
            Reply.error(ex, 404, "Lesson not found");
            return;
        }
        Reply.ok(ex, saved);
    }

    // DELETE /api/lessons/{id} (professor owner)
    private void delete(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "professor");
        if (session == null) return;

        if (loadOwned(ex, session, id) == null) return;

        int rows = LessonData.delete(id);
        if (rows == 0) {
            Reply.error(ex, 404, "Lesson not found");
            return;
        }
        Reply.ok(ex, Map.of());
    }

    // GET /api/lessons/{id}/file (professor owner, or student in the lesson's section)
    private void file(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "professor", "student");
        if (session == null) return;

        if (session.role.equals("professor")) {
            if (loadOwned(ex, session, id) == null) return;
        } else {
            if (!LessonData.visibleToStudent(id, session.userId)) {
                Reply.error(ex, 403, "This lesson is not for you");
                return;
            }
        }

        Map<String, Object> file = LessonData.getFile(id);
        if (file == null) {
            Reply.error(ex, 404, "File not found");
            return;
        }
        Reply.ok(ex, file);
    }

    // POST /api/lessons/{id}/done = mark done, DELETE = unmark (student)
    private void done(HttpExchange ex, long id, boolean mark) throws IOException {
        Auth.Session session = Auth.check(ex, "student");
        if (session == null) return;

        if (!LessonData.visibleToStudent(id, session.userId)) {
            Reply.error(ex, 403, "This lesson is not for you");
            return;
        }

        if (mark) {
            LessonData.markDone(session.userId, id);
        } else {
            LessonData.unmarkDone(session.userId, id);
        }
        Reply.ok(ex, Map.of());
    }

    // ----------------------------------------------------------------- helpers

    // Load a lesson and make sure it belongs to this professor.
    // Sends 404 or 403 and returns null when it does not.
    private static Map<String, Object> loadOwned(HttpExchange ex, Auth.Session session, long id)
            throws IOException {
        Map<String, Object> lesson = LessonData.get(id);
        if (lesson == null) {
            Reply.error(ex, 404, "Lesson not found");
            return null;
        }
        long owner = ((Number) lesson.get("professorId")).longValue();
        if (owner != session.userId) {
            Reply.error(ex, 403, "This is not your lesson");
            return null;
        }
        return lesson;
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
