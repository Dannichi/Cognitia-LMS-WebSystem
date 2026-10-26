import util.Json;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Small command-line smoke test for the Cognitia API.
 *
 * Requirements: run the backend first, keep MariaDB online, and use the seeded
 * admin account (admin@cognitia.edu / admin123). This test creates temporary
 * records and tries to delete them when it finishes.
 *
 * Run runtest.bat after start.bat has compiled the server and the backend is running.
 *
 * An optional first argument replaces the default API address:
 *   runtest.bat http://localhost:8000
 */
public class BackendSmokeTest {

    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private static final String STAMP = Long.toString(System.currentTimeMillis());
    private static final String TEST_PASSWORD = "TestPass123!";
    private static String baseUrl = "http://localhost:8000";

    private static String adminToken;
    private static String professorToken;
    private static String studentToken;

    private static Long programId;
    private static Long courseId;
    private static Long sectionId;
    private static Long professorId;
    private static Long studentId;
    private static Long announcementId;
    private static Long lessonId;
    private static Long assignmentId;
    private static Long quizId;

    private static int passed;
    private static int failed;
    private static int caseNumber;

    @FunctionalInterface
    private interface TestCase {
        void run() throws Exception;
    }

    private static final class Response {
        final int status;
        final Map<String, Object> body;

        Response(int status, Map<String, Object> body) {
            this.status = status;
            this.body = body;
        }
    }

    public static void main(String[] args) {
        if (args.length > 0 && !args[0].isBlank()) {
            baseUrl = args[0].replaceAll("/+$", "");
        }

        System.out.println("Cognitia API smoke test");
        System.out.println("Target: " + baseUrl);
        System.out.println("MariaDB must be running and the seeded admin must exist.\n");

        runCase("Seeded admin can log in", BackendSmokeTest::loginAdmin);
        runCase("Public program and section lists work", BackendSmokeTest::publicLists);
        runCase("Wrong password is rejected", BackendSmokeTest::wrongPassword);
        runCase("Admin session and user list work", BackendSmokeTest::adminSession);
        runCase("Create and update test program and course", BackendSmokeTest::createAcademicRecords);
        runCase("Create professor and assigned section", BackendSmokeTest::createProfessorAndSection);
        runCase("Student registration is pending until approved", BackendSmokeTest::registerAndApproveStudent);
        runCase("Professor and student access rules work", BackendSmokeTest::loginOtherRolesAndUpdateProfiles);
        runCase("Announcements can be created, read, updated, and deleted", BackendSmokeTest::testAnnouncements);
        runCase("Lessons support files and student progress", BackendSmokeTest::testLessons);
        runCase("Assignments support submissions and grading", BackendSmokeTest::testAssignments);
        runCase("Quizzes hide answers and support attempts and essay grading", BackendSmokeTest::testQuizzes);
        runCase("Grades require courseId and return calculated scores", BackendSmokeTest::testGrades);
        runCase("Activity permissions and logout work", BackendSmokeTest::testActivityAndLogout);
        runCase("Temporary users and academic records can be deleted", BackendSmokeTest::deleteFixtures);

        cleanup();

        System.out.println("\nSummary: " + passed + " passed, " + failed + " failed.");
        System.exit(failed == 0 ? 0 : 1);
    }

    private static void runCase(String name, TestCase test) {
        if (failed > 0) return; // Stop after a failure to avoid misleading follow-on failures.

        caseNumber++;
        System.out.printf("[%02d] RUN  %s%n", caseNumber, name);
        try {
            test.run();
            passed++;
            System.out.printf("[%02d] PASS %s%n\n", caseNumber, name);
        } catch (Exception | AssertionError e) {
            failed++;
            String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            System.out.printf("[%02d] FAIL %s -- %s%n\n", caseNumber, name, message);
        }
    }

    private static void loginAdmin() throws Exception {
        Map<String, Object> data = asMap(call("POST", "/api/login", obj(
                "email", "admin@cognitia.edu",
                "password", "admin123"), null, 200), "admin login");
        adminToken = text(data.get("token"));
        check(adminToken != null && !adminToken.isBlank(), "Login did not return a token");
    }

    private static void publicLists() throws Exception {
        asList(call("GET", "/api/programs", null, null, 200), "programs");
        asList(call("GET", "/api/sections", null, null, 200), "sections");
    }

    private static void wrongPassword() throws Exception {
        request("POST", "/api/login", obj(
                "email", "admin@cognitia.edu",
                "password", "not-the-password"), null, 401);
    }

    private static void adminSession() throws Exception {
        Map<String, Object> user = asMap(call("GET", "/api/me", null, adminToken, 200), "current user");
        check("admin".equals(user.get("role")), "GET /api/me did not return the admin");
        asList(call("GET", "/api/users", null, adminToken, 200), "users");
    }

    private static void createAcademicRecords() throws Exception {
        Map<String, Object> program = asMap(call("POST", "/api/programs", obj(
                "code", "T" + STAMP,
                "name", "Cognitia Test Program " + STAMP,
                "desc", "Temporary API test program",
                "status", "active",
                "color", "#336699",
                "catalogId", "test-" + STAMP,
                "departmentId", "test-dept",
                "campusId", "test-campus"), adminToken, 200), "new program");
        programId = asLong(program.get("id"), "program id");

        call("PUT", "/api/programs/" + programId, obj(
                "code", "T" + STAMP,
                "name", "Cognitia Test Program Updated " + STAMP,
                "desc", "Updated temporary API test program",
                "status", "active",
                "color", "#336699",
                "catalogId", "test-" + STAMP,
                "departmentId", "test-dept",
                "campusId", "test-campus"), adminToken, 200);

        Map<String, Object> course = asMap(call("POST", "/api/courses", obj(
                "code", "TC" + STAMP,
                "name", "Cognitia Test Course " + STAMP,
                "semester", 1,
                "units", 3,
                "status", "active",
                "programs", List.of(obj("programId", programId, "year", 1))),
                adminToken, 200), "new course");
        courseId = asLong(course.get("id"), "course id");

        call("PUT", "/api/courses/" + courseId, obj(
                "code", "TC" + STAMP,
                "name", "Cognitia Test Course Updated " + STAMP,
                "semester", 1,
                "units", 3,
                "status", "active",
                "programs", List.of(obj("programId", programId, "year", 1))),
                adminToken, 200);
    }

    private static void createProfessorAndSection() throws Exception {
        Map<String, Object> professor = asMap(call("POST", "/api/users", obj(
                "firstname", "Test",
                "middlename", "",
                "lastname", "Professor" + STAMP,
                "email", professorEmail(),
                "phone", "+639000" + STAMP,
                "password", TEST_PASSWORD,
                "role", "professor",
                "programId", programId,
                "status", "active"), adminToken, 200), "new professor");
        professorId = asLong(professor.get("id"), "professor id");

        Map<String, Object> section = asMap(call("POST", "/api/sections", sectionBody(10), adminToken, 200), "new section");
        sectionId = asLong(section.get("id"), "section id");

        call("PUT", "/api/sections/" + sectionId, sectionBody(12), adminToken, 200);
    }

    private static void registerAndApproveStudent() throws Exception {
        Map<String, Object> registered = asMap(call("POST", "/api/register", obj(
                "firstname", "Test",
                "middlename", "",
                "lastname", "Student" + STAMP,
                "email", studentEmail(),
                "phone", "+639111" + STAMP,
                "password", TEST_PASSWORD,
                "programId", programId,
                "sectionId", sectionId), null, 200), "registered student");
        studentId = asLong(registered.get("id"), "student id");

        request("POST", "/api/login", obj(
                "email", studentEmail(),
                "password", TEST_PASSWORD), null, 403);

        call("PUT", "/api/users/" + studentId + "/approval",
                obj("approvalStatus", "approved"), adminToken, 200);
    }

    private static void loginOtherRolesAndUpdateProfiles() throws Exception {
        professorToken = text(asMap(call("POST", "/api/login", obj(
                "email", professorEmail(),
                "password", TEST_PASSWORD), null, 200), "professor login").get("token"));
        studentToken = text(asMap(call("POST", "/api/login", obj(
                "email", studentEmail(),
                "password", TEST_PASSWORD), null, 200), "student login").get("token"));

        call("PUT", "/api/users/" + professorId,
                obj("phone", "+639222" + STAMP), adminToken, 200);
        call("PUT", "/api/users/" + studentId,
                obj("phone", "+639333" + STAMP), studentToken, 200);

        List<Map<String, Object>> professorUsers = asList(
                call("GET", "/api/users", null, professorToken, 200), "professor user list");
        check(!professorUsers.isEmpty(), "Professor did not receive student records");
        for (Map<String, Object> user : professorUsers) {
            check("student".equals(user.get("role")), "Professor received a non-student user");
        }

        asList(call("GET", "/api/courses", null, professorToken, 200), "professor courses");
        asList(call("GET", "/api/courses", null, studentToken, 200), "student courses");
    }

    private static void testAnnouncements() throws Exception {
        Map<String, Object> announcement = asMap(call("POST", "/api/announcements", announcementBody(
                "Test announcement " + STAMP, "Temporary announcement"), adminToken, 200), "announcement");
        announcementId = asLong(announcement.get("id"), "announcement id");

        asList(call("GET", "/api/announcements", null, studentToken, 200), "student announcements");
        call("POST", "/api/announcements/" + announcementId + "/read", null, studentToken, 200);
        call("PUT", "/api/announcements/" + announcementId,
                announcementBody("Updated test announcement " + STAMP, "Updated temporary announcement"),
                adminToken, 200);
        call("DELETE", "/api/announcements/" + announcementId, null, adminToken, 200);
        announcementId = null;
    }

    private static void testLessons() throws Exception {
        Map<String, Object> lesson = asMap(call("POST", "/api/lessons", obj(
                "title", "Test lesson " + STAMP,
                "courseId", courseId,
                "desc", "Temporary lesson",
                "fileName", "lesson.txt",
                "fileData", fileData(),
                "sectionIds", List.of(sectionId)), professorToken, 200), "lesson");
        lessonId = asLong(lesson.get("id"), "lesson id");

        asList(call("GET", "/api/lessons?courseId=" + courseId, null, studentToken, 200), "student lessons");
        call("GET", "/api/lessons/" + lessonId + "/file", null, studentToken, 200);
        call("POST", "/api/lessons/" + lessonId + "/done", null, studentToken, 200);
        call("DELETE", "/api/lessons/" + lessonId + "/done", null, studentToken, 200);
        call("PUT", "/api/lessons/" + lessonId, obj(
                "title", "Updated test lesson " + STAMP,
                "courseId", courseId,
                "desc", "Updated temporary lesson",
                "fileName", "lesson.txt",
                "sectionIds", List.of(sectionId)), professorToken, 200);
    }

    private static void testAssignments() throws Exception {
        Map<String, Object> assignment = asMap(call("POST", "/api/assignments", obj(
                "title", "Test assignment " + STAMP,
                "courseId", courseId,
                "desc", "Temporary assignment",
                "dueDate", "2026-12-31T23:59:00",
                "points", 10,
                "attachmentName", "assignment.txt",
                "attachmentType", "text/plain",
                "attachmentData", fileData(),
                "sectionIds", List.of(sectionId)), professorToken, 200), "assignment");
        assignmentId = asLong(assignment.get("id"), "assignment id");

        asList(call("GET", "/api/assignments?courseId=" + courseId, null, studentToken, 200), "student assignments");
        call("GET", "/api/assignments/" + assignmentId + "/file", null, studentToken, 200);
        Map<String, Object> submissionBody = obj(
                "note", "Test submission",
                "fileName", "submission.txt",
                "fileData", fileData());
        call("POST", "/api/assignments/" + assignmentId + "/submissions",
                submissionBody, studentToken, 200);
        call("POST", "/api/assignments/" + assignmentId + "/submissions",
                obj("note", "Replacement submission", "fileName", "submission.txt", "fileData", fileData()),
                studentToken, 200);

        List<Map<String, Object>> submissions = asList(call(
                "GET", "/api/assignments/" + assignmentId + "/submissions", null, professorToken, 200),
                "submissions");
        check(!submissions.isEmpty(), "Professor did not receive the submission");
        Long submissionId = asLong(submissions.get(0).get("id"), "submission id");
        call("GET", "/api/submissions/" + submissionId + "/file", null, professorToken, 200);
        call("PUT", "/api/submissions/" + submissionId + "/grade",
                obj("grade", 8, "feedback", "Good work"), professorToken, 200);
        request("POST", "/api/assignments/" + assignmentId + "/submissions",
                submissionBody, studentToken, 409);

        call("PUT", "/api/assignments/" + assignmentId, obj(
                "title", "Updated test assignment " + STAMP,
                "courseId", courseId,
                "desc", "Updated temporary assignment",
                "dueDate", "2026-12-31T23:59:00",
                "points", 10,
                "attachmentName", "assignment.txt",
                "attachmentType", "text/plain",
                "sectionIds", List.of(sectionId)), professorToken, 200);
    }

    private static void testQuizzes() throws Exception {
        List<Map<String, Object>> questions = new ArrayList<>();
        questions.add(obj(
                "type", "mcq",
                "text", "Which option is correct?",
                "points", 1,
                "optionA", "A",
                "optionB", "B",
                "optionC", "C",
                "optionD", "D",
                "correct", "A"));
        questions.add(obj(
                "type", "essay",
                "text", "Explain the test.",
                "points", 2,
                "rubric", "Clear explanation"));

        Map<String, Object> quiz = asMap(call("POST", "/api/quizzes", obj(
                "title", "Test quiz " + STAMP,
                "courseId", courseId,
                "dueDate", "2026-12-31T23:59:00",
                "timeLimit", 15,
                "sectionIds", List.of(sectionId),
                "questions", questions), professorToken, 200), "quiz");
        quizId = asLong(quiz.get("id"), "quiz id");
        List<Map<String, Object>> savedQuestions = asList(quiz.get("questions"), "quiz questions");
        Long mcqId = asLong(savedQuestions.get(0).get("id"), "MCQ id");
        Long essayId = asLong(savedQuestions.get(1).get("id"), "essay id");

        List<Map<String, Object>> studentQuizzes = asList(call(
                "GET", "/api/quizzes?courseId=" + courseId, null, studentToken, 200), "student quizzes");
        Map<String, Object> safeQuiz = findById(studentQuizzes, quizId);
        check(safeQuiz != null, "Student could not see the assigned quiz");
        List<Map<String, Object>> safeQuestions = asList(safeQuiz.get("questions"), "student quiz questions");
        check(!safeQuestions.get(0).containsKey("correct"), "Student quiz reply exposed a correct answer");
        check(!safeQuestions.get(1).containsKey("rubric"), "Student quiz reply exposed an essay rubric");

        call("POST", "/api/quizzes/" + quizId + "/attempt", obj("answers", List.of(
                obj("questionId", mcqId, "answer", "A"),
                obj("questionId", essayId, "answer", "A clear test answer"))), studentToken, 200);

        List<Map<String, Object>> attempts = asList(call(
                "GET", "/api/quizzes/" + quizId + "/attempts", null, professorToken, 200), "quiz attempts");
        check(!attempts.isEmpty(), "Professor did not receive the quiz attempt");
        Long attemptId = asLong(attempts.get(0).get("id"), "attempt id");
        call("PUT", "/api/attempts/" + attemptId + "/grade",
                obj("essays", List.of(obj("questionId", essayId, "pointsAwarded", 2, "feedback", "Clear"))),
                professorToken, 200);

        request("PUT", "/api/quizzes/" + quizId, obj(
                "title", "Edited quiz should conflict",
                "courseId", courseId,
                "dueDate", "2026-12-31T23:59:00",
                "timeLimit", 15,
                "sectionIds", List.of(sectionId),
                "questions", savedQuestions), professorToken, 409);
    }

    private static void testGrades() throws Exception {
        request("GET", "/api/grades", null, professorToken, 400);

        List<Map<String, Object>> professorGrades = asList(call(
                "GET", "/api/grades?courseId=" + courseId, null, professorToken, 200), "professor grades");
        Map<String, Object> studentGrade = findByField(professorGrades, "studentId", studentId);
        check(studentGrade != null, "Professor grade response omitted the test student");
        check(decimal(studentGrade.get("assignmentGrade")) != null,
                "Graded assignment did not affect assignmentGrade");
        check(decimal(studentGrade.get("quizScore")) != null,
                "Graded quiz did not affect quizScore");

        double assignmentGrade = decimal(studentGrade.get("assignmentGrade"));
        double quizScore = decimal(studentGrade.get("quizScore"));
        double finalGrade = decimal(studentGrade.get("finalGrade"));
        check(Math.abs(assignmentGrade - 80.0) < 0.01, "Expected assignment grade 80.00 but got " + assignmentGrade);
        check(Math.abs(quizScore - 100.0) < 0.01, "Expected quiz score 100.00 but got " + quizScore);
        check(Math.abs(finalGrade - 90.0) < 0.01, "Expected final grade 90.00 but got " + finalGrade);

        List<Map<String, Object>> ownGrades = asList(call(
                "GET", "/api/grades?courseId=" + courseId, null, studentToken, 200), "student grades");
        check(ownGrades.size() == 1, "Student grade response should contain only their record");
        check(asLong(ownGrades.get(0).get("studentId"), "student id").equals(studentId),
                "Student grade response contained another student's record");
    }

    private static void testActivityAndLogout() throws Exception {
        asList(call("GET", "/api/activity", null, adminToken, 200), "activity log");
        request("GET", "/api/activity", null, professorToken, 403);
        request("GET", "/api/grades?courseId=" + courseId, null, null, 401);
        call("POST", "/api/logout", null, studentToken, 200);
        studentToken = null;
    }

    private static void deleteFixtures() throws Exception {
        if (quizId != null) {
            call("DELETE", "/api/quizzes/" + quizId, null, professorToken, 200);
            quizId = null;
        }
        if (assignmentId != null) {
            call("DELETE", "/api/assignments/" + assignmentId, null, professorToken, 200);
            assignmentId = null;
        }
        if (lessonId != null) {
            call("DELETE", "/api/lessons/" + lessonId, null, professorToken, 200);
            lessonId = null;
        }
        if (studentId != null) {
            call("DELETE", "/api/users/" + studentId, null, adminToken, 200);
            studentId = null;
        }
        if (professorId != null) {
            call("DELETE", "/api/users/" + professorId, null, adminToken, 200);
            professorId = null;
        }
        if (sectionId != null) {
            call("DELETE", "/api/sections/" + sectionId, null, adminToken, 200);
            sectionId = null;
        }
        if (courseId != null) {
            call("DELETE", "/api/courses/" + courseId, null, adminToken, 200);
            courseId = null;
        }
        if (programId != null) {
            call("DELETE", "/api/programs/" + programId, null, adminToken, 200);
            programId = null;
        }
    }

    private static Map<String, Object> sectionBody(int capacity) {
        return obj(
                "programId", programId,
                "year", 1,
                "letter", "A",
                "capacity", capacity,
                "courseIds", List.of(courseId),
                "professorAssignments", List.of(obj(
                        "professorId", professorId,
                        "courseIds", List.of(courseId))));
    }

    private static Map<String, Object> announcementBody(String title, String body) {
        return obj(
                "title", title,
                "body", body,
                "type", "general",
                "category", "test",
                "audience", "all",
                "featured", false,
                "status", "published",
                "scheduledAt", null,
                "eventDate", null);
    }

    private static String professorEmail() {
        return "prof." + STAMP + "@cognitia.test";
    }

    private static String studentEmail() {
        return "student." + STAMP + "@cognitia.test";
    }

    private static String fileData() {
        return Base64.getEncoder().encodeToString(
                "Cognitia temporary test file".getBytes(StandardCharsets.UTF_8));
    }

    private static Response request(String method, String path, Object body, String token, int expectedStatus)
            throws Exception {
        String url = baseUrl + path;
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .header("Accept", "application/json");
        if (token != null) builder.header("Authorization", "Bearer " + token);

        if (body == null) {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            builder.header("Content-Type", "application/json; charset=utf-8");
            builder.method(method, HttpRequest.BodyPublishers.ofString(Json.stringify(body)));
        }

        HttpResponse<String> response = HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        Map<String, Object> parsed = null;
        if (!response.body().isBlank()) {
            parsed = Json.asMap(Json.parse(response.body()));
        }

        if (response.statusCode() != expectedStatus) {
            Object error = parsed == null ? null : parsed.get("error");
            throw new AssertionError(method + " " + path + " expected HTTP " + expectedStatus
                    + " but got " + response.statusCode()
                    + (error == null ? "" : ": " + error));
        }
        return new Response(response.statusCode(), parsed);
    }

    private static Object call(String method, String path, Object body, String token,
                               int expectedStatus) throws Exception {
        Response response = request(method, path, body, token, expectedStatus);
        if (expectedStatus < 200 || expectedStatus >= 300) {
            return response.body == null ? Map.of() : response.body;
        }
        check(response.body != null && Boolean.TRUE.equals(response.body.get("ok")),
                method + " " + path + " did not return ok=true");
        return response.body.get("data");
    }

    private static Map<String, Object> obj(Object... pairs) {
        return Json.map(pairs);
    }

    private static Map<String, Object> asMap(Object value, String label) {
        if (!(value instanceof Map<?, ?>)) {
            throw new AssertionError(label + " was not an object");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) value;
        return result;
    }

    private static List<Map<String, Object>> asList(Object value, String label) {
        if (!(value instanceof List<?>)) {
            throw new AssertionError(label + " was not a list");
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : (List<?>) value) result.add(asMap(item, label + " item"));
        return result;
    }

    private static Map<String, Object> findById(List<Map<String, Object>> rows, Long id) {
        return findByField(rows, "id", id);
    }

    private static Map<String, Object> findByField(List<Map<String, Object>> rows, String field, Long id) {
        for (Map<String, Object> row : rows) {
            Number rowId = number(row.get(field));
            if (rowId != null && rowId.longValue() == id) return row;
        }
        return null;
    }

    private static Long asLong(Object value, String label) {
        Number number = number(value);
        if (number == null) throw new AssertionError(label + " was missing");
        return number.longValue();
    }

    private static Number number(Object value) {
        return value instanceof Number ? (Number) value : null;
    }

    private static Double decimal(Object value) {
        return value instanceof Number ? ((Number) value).doubleValue() : null;
    }

    private static String text(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void cleanup() {
        if (adminToken == null) return;

        // Best effort: clean any fixture left behind if a case stopped early.
        cleanupDelete("/api/quizzes/" + quizId);
        cleanupDelete("/api/assignments/" + assignmentId);
        cleanupDelete("/api/lessons/" + lessonId);
        cleanupDelete("/api/announcements/" + announcementId);
        cleanupDelete("/api/sections/" + sectionId);
        cleanupDelete("/api/courses/" + courseId);
        cleanupDelete("/api/users/" + studentId);
        cleanupDelete("/api/users/" + professorId);
        cleanupDelete("/api/programs/" + programId);
    }

    private static void cleanupDelete(String path) {
        if (path.endsWith("/null")) return;
        try {
            request("DELETE", path, null, adminToken, 200);
        } catch (Exception e) {
            System.out.println("[CLEANUP WARN] Could not delete " + path + ": " + e.getMessage());
        }
    }
}
