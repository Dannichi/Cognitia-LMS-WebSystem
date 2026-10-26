package handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import data.AcademicData;
import data.AssignmentData;
import util.Auth;
import util.Database;
import util.Reply;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * AssignmentHandler:
 *   /api/assignments, /api/assignments/{id}, /api/assignments/{id}/file,
 *   /api/assignments/{id}/submissions,
 *   /api/submissions/{id}/file, /api/submissions/{id}/grade
 * Tables used (through AssignmentData / AcademicData): assignments, assignment_sections, submissions.
 * Main must register this handler on "/api/assignments" AND "/api/submissions".
 * Assignments are not written to the activity log.
 */
public class AssignmentHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws IOException {
        // Step 1: CORS preflight
        if (Reply.handlePreflight(ex)) return;

        try {
            String method = ex.getRequestMethod();
            // "/api/assignments/7/file" -> ["assignments","7","file"]
            String[] parts = ex.getRequestURI().getPath().substring(5).split("/");

            // Step 3: route by first part, number of parts and method
            if (parts[0].equals("assignments")) {
                if (parts.length == 1 && method.equals("GET")) {
                    list(ex);
                } else if (parts.length == 1 && method.equals("POST")) {
                    create(ex);
                } else if (parts.length == 2 && method.equals("PUT")) {
                    update(ex, parseId(parts[1]));
                } else if (parts.length == 2 && method.equals("DELETE")) {
                    delete(ex, parseId(parts[1]));
                } else if (parts.length == 3 && parts[2].equals("file") && method.equals("GET")) {
                    assignmentFile(ex, parseId(parts[1]));
                } else if (parts.length == 3 && parts[2].equals("submissions") && method.equals("POST")) {
                    submit(ex, parseId(parts[1]));
                } else if (parts.length == 3 && parts[2].equals("submissions") && method.equals("GET")) {
                    listSubmissions(ex, parseId(parts[1]));
                } else {
                    Reply.error(ex, 404, "Not found");
                }
            } else if (parts[0].equals("submissions")) {
                if (parts.length == 3 && parts[2].equals("file") && method.equals("GET")) {
                    submissionFile(ex, parseId(parts[1]));
                } else if (parts.length == 3 && parts[2].equals("grade") && method.equals("PUT")) {
                    grade(ex, parseId(parts[1]));
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

    // ------------------------------------------------------------ assignments

    // GET /api/assignments?courseId=  (professor: own, student: own section)
    private void list(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "professor", "student");
        if (session == null) return;

        Long courseId = courseIdParam(ex);
        Reply.ok(ex, AssignmentData.list(session.role, session.userId, courseId));
    }

    // POST /api/assignments (professor who teaches that course and those sections)
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

        Reply.ok(ex, AssignmentData.create(session.userId, body));
    }

    // PUT /api/assignments/{id} (professor owner)
    private void update(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "professor");
        if (session == null) return;

        Map<String, Object> assignment = loadOwned(ex, session, id);
        if (assignment == null) return;   // 404 or 403 already sent

        Map<String, Object> body = Reply.readJson(ex);

        // If the body does not send a courseId, the assignment keeps its old course
        Object course = body.get("courseId");
        long courseId = (course instanceof Number)
                ? ((Number) course).longValue()
                : ((Number) assignment.get("courseId")).longValue();

        if (!checkTeaching(ex, session, courseId, body.get("sectionIds"))) return;

        Map<String, Object> saved = AssignmentData.update(id, body);
        if (saved == null) {
            Reply.error(ex, 404, "Assignment not found");
            return;
        }
        Reply.ok(ex, saved);
    }

    // DELETE /api/assignments/{id} (professor owner)
    private void delete(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "professor");
        if (session == null) return;

        if (loadOwned(ex, session, id) == null) return;

        int rows = AssignmentData.delete(id);
        if (rows == 0) {
            Reply.error(ex, 404, "Assignment not found");
            return;
        }
        Reply.ok(ex, Map.of());
    }

    // GET /api/assignments/{id}/file (professor owner, or student in the section)
    private void assignmentFile(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "professor", "student");
        if (session == null) return;

        if (session.role.equals("professor")) {
            if (loadOwned(ex, session, id) == null) return;
        } else if (!AssignmentData.visibleToStudent(id, session.userId)) {
            Reply.error(ex, 403, "This assignment is not for you");
            return;
        }

        Map<String, Object> file = AssignmentData.getFile(id);
        if (file == null) {
            Reply.error(ex, 404, "File not found");
            return;
        }
        Reply.ok(ex, file);
    }

    // ------------------------------------------------------------ submissions

    // POST /api/assignments/{id}/submissions (student). Sending again replaces it.
    private void submit(HttpExchange ex, long assignmentId) throws IOException {
        Auth.Session session = Auth.check(ex, "student");
        if (session == null) return;

        if (!AssignmentData.visibleToStudent(assignmentId, session.userId)) {
            Reply.error(ex, 403, "This assignment is not for you");
            return;
        }

        Map<String, Object> body = Reply.readJson(ex);
        Map<String, Object> submission = AssignmentData.submit(assignmentId, session.userId, body);

        // null means it was already graded, so it cannot be replaced
        if (submission == null) {
            Reply.error(ex, 409, "Already graded. You cannot submit again");
            return;
        }
        Reply.ok(ex, submission);
    }

    // GET /api/assignments/{id}/submissions (professor owner: all, student: own only)
    private void listSubmissions(HttpExchange ex, long assignmentId) throws IOException {
        Auth.Session session = Auth.check(ex, "professor", "student");
        if (session == null) return;

        if (session.role.equals("professor")) {
            if (loadOwned(ex, session, assignmentId) == null) return;
            Reply.ok(ex, AssignmentData.listSubmissions(assignmentId, null));   // null = all
        } else {
            if (!AssignmentData.visibleToStudent(assignmentId, session.userId)) {
                Reply.error(ex, 403, "This assignment is not for you");
                return;
            }
            // A student always passes their OWN id, so they only see their own
            Reply.ok(ex, AssignmentData.listSubmissions(assignmentId, session.userId));
        }
    }

    // GET /api/submissions/{id}/file (professor owner of the assignment, or the student who sent it)
    private void submissionFile(HttpExchange ex, long submissionId) throws IOException {
        Auth.Session session = Auth.check(ex, "professor", "student");
        if (session == null) return;

        Map<String, Object> submission = AssignmentData.getSubmission(submissionId);
        if (submission == null) {
            Reply.error(ex, 404, "Submission not found");
            return;
        }

        if (session.role.equals("student")) {
            long owner = ((Number) submission.get("studentId")).longValue();
            if (owner != session.userId) {
                Reply.error(ex, 403, "This is not your submission");
                return;
            }
        } else {
            long assignmentId = ((Number) submission.get("assignmentId")).longValue();
            if (loadOwned(ex, session, assignmentId) == null) return;
        }

        Map<String, Object> file = AssignmentData.getSubmissionFile(submissionId);
        if (file == null) {
            Reply.error(ex, 404, "File not found");
            return;
        }
        Reply.ok(ex, file);
    }

    // PUT /api/submissions/{id}/grade (professor owner of the assignment)
    private void grade(HttpExchange ex, long submissionId) throws IOException {
        Auth.Session session = Auth.check(ex, "professor");
        if (session == null) return;

        Map<String, Object> submission = AssignmentData.getSubmission(submissionId);
        if (submission == null) {
            Reply.error(ex, 404, "Submission not found");
            return;
        }
        long assignmentId = ((Number) submission.get("assignmentId")).longValue();
        if (loadOwned(ex, session, assignmentId) == null) return;

        Map<String, Object> body = Reply.readJson(ex);
        // The data class checks 0 <= grade <= points and throws IllegalArgumentException (-> 400)
        Map<String, Object> graded = AssignmentData.grade(submissionId, body);
        if (graded == null) {
            Reply.error(ex, 404, "Submission not found");
            return;
        }
        Reply.ok(ex, graded);
    }

    // ----------------------------------------------------------------- helpers

    // Load an assignment and make sure it belongs to this professor.
    // Sends 404 or 403 and returns null when it does not.
    private static Map<String, Object> loadOwned(HttpExchange ex, Auth.Session session, long id)
            throws IOException {
        Map<String, Object> assignment = AssignmentData.get(id);
        if (assignment == null) {
            Reply.error(ex, 404, "Assignment not found");
            return null;
        }
        long owner = ((Number) assignment.get("professorId")).longValue();
        if (owner != session.userId) {
            Reply.error(ex, 403, "This is not your assignment");
            return null;
        }
        return assignment;
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
