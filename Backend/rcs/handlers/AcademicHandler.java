package handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import data.AcademicData;
import data.ActivityData;
import util.Auth;
import util.Database;
import util.Reply;

import java.io.IOException;
import java.util.Map;

/**
 * AcademicHandler: /api/programs, /api/sections, /api/courses (and /{id} on each).
 * Tables used (through AcademicData / ActivityData): programs, sections, courses,
 * course_programs, section_courses, teaching_assignments, activity_log.
 * Main must register this handler on all three paths.
 */
public class AcademicHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws IOException {
        // Step 1: CORS preflight
        if (Reply.handlePreflight(ex)) return;

        try {
            String method = ex.getRequestMethod();
            // "/api/programs/3" -> "programs/3" -> ["programs","3"]
            String[] parts = ex.getRequestURI().getPath().substring(5).split("/");

            if (parts.length > 2) {
                Reply.error(ex, 404, "Not found");
                return;
            }
            boolean hasId = parts.length == 2;
            long id = hasId ? parseId(parts[1]) : 0;

            // Step 3: route by the first path part
            if (parts[0].equals("programs")) {
                programs(ex, method, hasId, id);
            } else if (parts[0].equals("sections")) {
                sections(ex, method, hasId, id);
            } else if (parts[0].equals("courses")) {
                courses(ex, method, hasId, id);
            } else {
                Reply.error(ex, 404, "Not found");
            }
        } catch (Exception e) {
            fail(ex, e);
        }
    }

    // ---------------------------------------------------------------- programs

    private void programs(HttpExchange ex, String method, boolean hasId, long id) throws IOException {
        // GET is public: no login needed
        if (method.equals("GET") && !hasId) {
            Reply.ok(ex, AcademicData.listPrograms());
            return;
        }

        // Everything else is admin only
        Auth.Session session = Auth.check(ex, "admin");
        if (session == null) return;

        if (method.equals("POST") && !hasId) {
            Map<String, Object> body = Reply.readJson(ex);
            Map<String, Object> program = AcademicData.createProgram(body);
            log(session, "program", program.get("id"), programLabel(program), "created");
            Reply.ok(ex, program);

        } else if (method.equals("PUT") && hasId) {
            Map<String, Object> body = Reply.readJson(ex);
            Map<String, Object> program = AcademicData.updateProgram(id, body);
            if (program == null) {
                Reply.error(ex, 404, "Program not found");
                return;
            }
            log(session, "program", id, programLabel(program), "updated");
            Reply.ok(ex, program);

        } else if (method.equals("DELETE") && hasId) {
            // Read first so we still know the name after it is deleted
            Map<String, Object> old = AcademicData.getProgram(id);
            if (old == null) {
                Reply.error(ex, 404, "Program not found");
                return;
            }
            // A program that still has sections throws a foreign key error (-> 400 in fail)
            int rows = AcademicData.deleteProgram(id);
            if (rows == 0) {
                Reply.error(ex, 404, "Program not found");
                return;
            }
            log(session, "program", id, programLabel(old), "deleted");
            Reply.ok(ex, Map.of());

        } else {
            Reply.error(ex, 404, "Not found");
        }
    }

    // ---------------------------------------------------------------- sections

    private void sections(HttpExchange ex, String method, boolean hasId, long id) throws IOException {
        // GET is public
        if (method.equals("GET") && !hasId) {
            Reply.ok(ex, AcademicData.listSections());
            return;
        }

        Auth.Session session = Auth.check(ex, "admin");
        if (session == null) return;

        if (method.equals("POST") && !hasId) {
            Map<String, Object> body = Reply.readJson(ex);
            Map<String, Object> section = AcademicData.createSection(body);
            log(session, "section", section.get("id"), sectionLabel(section), "created");
            Reply.ok(ex, section);

        } else if (method.equals("PUT") && hasId) {
            Map<String, Object> body = Reply.readJson(ex);
            Map<String, Object> section = AcademicData.updateSection(id, body);
            if (section == null) {
                Reply.error(ex, 404, "Section not found");
                return;
            }
            log(session, "section", id, sectionLabel(section), "updated");
            Reply.ok(ex, section);

        } else if (method.equals("DELETE") && hasId) {
            Map<String, Object> old = AcademicData.getSection(id);
            if (old == null) {
                Reply.error(ex, 404, "Section not found");
                return;
            }
            int rows = AcademicData.deleteSection(id);
            if (rows == 0) {
                Reply.error(ex, 404, "Section not found");
                return;
            }
            log(session, "section", id, sectionLabel(old), "deleted");
            Reply.ok(ex, Map.of());

        } else {
            Reply.error(ex, 404, "Not found");
        }
    }

    // ----------------------------------------------------------------- courses

    private void courses(HttpExchange ex, String method, boolean hasId, long id) throws IOException {
        // GET needs a login. The data class filters by role:
        // admin = all, professor = courses they teach, student = active courses of own program.
        if (method.equals("GET") && !hasId) {
            Auth.Session viewer = Auth.check(ex, "admin", "professor", "student");
            if (viewer == null) return;
            Reply.ok(ex, AcademicData.listCourses(viewer.role, viewer.userId));
            return;
        }

        Auth.Session session = Auth.check(ex, "admin");
        if (session == null) return;

        if (method.equals("POST") && !hasId) {
            Map<String, Object> body = Reply.readJson(ex);
            Map<String, Object> course = AcademicData.createCourse(body);
            log(session, "course", course.get("id"), courseLabel(course), "created");
            Reply.ok(ex, course);

        } else if (method.equals("PUT") && hasId) {
            Map<String, Object> body = Reply.readJson(ex);
            Map<String, Object> course = AcademicData.updateCourse(id, body);
            if (course == null) {
                Reply.error(ex, 404, "Course not found");
                return;
            }
            log(session, "course", id, courseLabel(course), "updated");
            Reply.ok(ex, course);

        } else if (method.equals("DELETE") && hasId) {
            Map<String, Object> old = AcademicData.getCourse(id);
            if (old == null) {
                Reply.error(ex, 404, "Course not found");
                return;
            }
            int rows = AcademicData.deleteCourse(id);
            if (rows == 0) {
                Reply.error(ex, 404, "Course not found");
                return;
            }
            log(session, "course", id, courseLabel(old), "deleted");
            Reply.ok(ex, Map.of());

        } else {
            Reply.error(ex, 404, "Not found");
        }
    }

    // ----------------------------------------------------------------- helpers

    // Write one activity row. Called only AFTER the save succeeded.
    private static void log(Auth.Session session, String entityType, Object entityId,
                            String label, String action) {
        long id = ((Number) entityId).longValue();
        ActivityData.log(session.userId, entityType, id, label,
                action, action + " " + entityType + " " + label, null);
    }

    private static String programLabel(Map<String, Object> p) {
        return String.valueOf(p.get("code"));
    }

    private static String sectionLabel(Map<String, Object> s) {
        return "Year " + s.get("year") + " Section " + s.get("letter");
    }

    private static String courseLabel(Map<String, Object> c) {
        return c.get("code") + " " + c.get("name");
    }

    // Text -> number. A bad number becomes a 400 error.
    private static long parseId(String text) {
        try {
            return Long.parseLong(text);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Bad id in the URL");
        }
    }

    // Turn an exception into the right error reply (the agreed error mapping).
    private static void fail(HttpExchange ex, Exception e) throws IOException {
        if (e instanceof IllegalArgumentException) {
            Reply.error(ex, 400, e.getMessage());
        } else if (Database.isDuplicate(e)) {
            Reply.error(ex, 409, "That record already exists (for example, the code is taken)");
        } else if (Database.isForeignKeyError(e)) {
            Reply.error(ex, 400, "That record is linked to other data");
        } else {
            Reply.error(ex, 500, "Server error");
        }
    }
}
