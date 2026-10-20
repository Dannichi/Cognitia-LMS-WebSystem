package data;

// ============================================================================
// AssignmentData.java  (folder: backend/rcs/data/)
//
// Covers tables : assignments, assignment_sections, submissions
// Used by       : AssignmentHandler
//                 (/api/assignments..., /api/assignments/{id}/submissions,
//                  /api/submissions/{id}/file, /api/submissions/{id}/grade)
//
// Rules for this file:
//  - This is the ONLY place with SQL about assignments and submissions.
//  - FILES: base64 text from the browser is DECODED and stored as real bytes in
//    the LONGBLOB columns; file requests encode the bytes back to base64 text.
//    List replies never contain file data.
//  - Ownership checks are done by the HANDLER. This class gives it what it needs:
//      get(id).professorId, getSubmission(id).studentId / assignmentId,
//      visibleToStudent(...), AcademicData.teachesSection(...)
//  - The server decides submittedAt, status, gradedAt. The browser never sends them.
//  - Bad input -> IllegalArgumentException (handler -> 400).
// ============================================================================

import util.Database;

import java.sql.Blob;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AssignmentData {

    // Assignment columns sent to the browser (attachment_data is NOT here on purpose).
    // "desc" is a reserved SQL word, so the alias is written with backticks.
    private static final String COLUMNS =
            "a.id, " +
            "a.course_id AS courseId, " +
            "a.professor_id AS professorId, " +
            "a.title, " +
            "a.description AS `desc`, " +
            "a.due_date AS dueDate, " +
            "a.points, " +
            "a.attachment_name AS attachmentName, " +
            "a.attachment_type AS attachmentType, " +
            "a.created_at AS createdAt";

    // Submission columns sent to the browser (file_data is NOT here on purpose).
    private static final String SUBMISSION_SELECT =
            "SELECT s.id, " +
            "s.assignment_id AS assignmentId, " +
            "s.student_id AS studentId, " +
            "CONCAT(u.first_name, ' ', u.last_name) AS studentName, " +
            "s.note, " +
            "s.file_name AS fileName, " +
            "s.status, " +
            "s.grade, " +
            "s.feedback, " +
            "s.submitted_at AS submittedAt, " +
            "s.graded_at AS gradedAt " +
            "FROM submissions s JOIN users u ON u.id = s.student_id ";

    // ==================================================================
    // ASSIGNMENTS - READ
    // ==================================================================

    // GET /api/assignments?courseId=   (courseId may be null = all courses)
    //   professor -> the assignments they created
    //   student   -> assignments given to THEIR section, each with "submitted" true/false
    public static List<Map<String, Object>> list(String role, long userId, Long courseId) {
        StringBuilder sql = new StringBuilder();
        List<Object> params = new ArrayList<>();

        if ("professor".equals(role)) {
            sql.append("SELECT ").append(COLUMNS)
               .append(" FROM assignments a WHERE a.professor_id = ?");
            params.add(userId);

        } else if ("student".equals(role)) {
            // assignments -> assignment_sections -> the student's own section.
            // LEFT JOIN submissions tells us if this student already submitted.
            sql.append("SELECT ").append(COLUMNS).append(", s.id AS submissionId")
               .append(" FROM assignments a")
               .append(" JOIN assignment_sections asec ON asec.assignment_id = a.id")
               .append(" JOIN users u ON u.section_id = asec.section_id")
               .append(" LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = u.id")
               .append(" WHERE u.id = ?");
            params.add(userId);

        } else {
            throw new IllegalArgumentException("Only professors and students have assignments");
        }

        if (courseId != null) {
            sql.append(" AND a.course_id = ?");
            params.add(courseId);
        }
        sql.append(" ORDER BY a.created_at DESC, a.id DESC");

        List<Map<String, Object>> rows = Database.query(sql.toString(), params.toArray());

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(tidy(row));
        }
        return result;
    }

    // One assignment (with sectionIds, no file data) or null if not found.
    // The handler uses its "professorId" for the "is this your assignment?" check.
    public static Map<String, Object> get(long id) {
        Map<String, Object> row = Database.queryOne(
                "SELECT " + COLUMNS + " FROM assignments a WHERE a.id = ?", id);
        if (row == null) {
            return null;
        }
        return tidy(row);
    }

    // Cleans one row: adds "sectionIds" and, for students, turns "submissionId" into "submitted".
    private static Map<String, Object> tidy(Map<String, Object> row) {
        Map<String, Object> assignment = new LinkedHashMap<>(row); // copy so we can add keys
        long assignmentId = ((Number) row.get("id")).longValue();

        List<Map<String, Object>> links = Database.query(
                "SELECT section_id AS sectionId FROM assignment_sections " +
                "WHERE assignment_id = ? ORDER BY section_id",
                assignmentId);
        List<Object> sectionIds = new ArrayList<>();
        for (Map<String, Object> link : links) {
            sectionIds.add(link.get("sectionId"));
        }
        assignment.put("sectionIds", sectionIds);

        // Only the student query has "submissionId"
        if (assignment.containsKey("submissionId")) {
            assignment.put("submitted", assignment.get("submissionId") != null);
            assignment.remove("submissionId");
        }
        return assignment;
    }

    // GET /api/assignments/{id}/file
    // Returns {attachmentName, attachmentType, attachmentData} (data is base64 text,
    // null if there is no attachment), or null if the assignment does not exist.
    public static Map<String, Object> getFile(long id) {
        Map<String, Object> row = Database.queryOne(
                "SELECT attachment_name AS attachmentName, attachment_type AS attachmentType, " +
                "attachment_data AS attachmentData FROM assignments WHERE id = ?", id);
        if (row == null) {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("attachmentName", row.get("attachmentName"));
        result.put("attachmentType", row.get("attachmentType"));
        result.put("attachmentData", encodeFile(row.get("attachmentData")));
        return result;
    }

    // true if this assignment was given to the student's own section.
    public static boolean visibleToStudent(long assignmentId, long studentId) {
        Map<String, Object> row = Database.queryOne(
                "SELECT 1 AS found FROM assignment_sections asec " +
                "JOIN users u ON u.section_id = asec.section_id " +
                "WHERE asec.assignment_id = ? AND u.id = ? LIMIT 1",
                assignmentId, studentId);
        return row != null;
    }

    // ==================================================================
    // ASSIGNMENTS - CREATE / UPDATE / DELETE  (professor; handler checks ownership)
    // ==================================================================

    // POST /api/assignments. professorId = the logged-in professor. Returns the new assignment.
    public static Map<String, Object> create(long professorId, Map<String, Object> input) {
        // ---- validate and read the input BEFORE touching the database ----
        String title = text(input, "title");
        Integer courseId = number(input, "courseId");
        Integer points = number(input, "points");
        List<Long> sectionIds = idList(input.get("sectionIds"));

        if (title == null || courseId == null) {
            throw new IllegalArgumentException("title and courseId are required");
        }
        if (title.length() > 200) {
            throw new IllegalArgumentException("title is too long (max 200 characters)");
        }
        if (points == null) {
            points = 100; // same default as the table
        }
        if (points < 1) {
            throw new IllegalArgumentException("points must be at least 1");
        }
        if (sectionIds.isEmpty()) {
            throw new IllegalArgumentException("Choose at least one section");
        }
        Timestamp dueDate = readDueDate(input);

        // The attachment is optional. Decode the base64 text to real bytes.
        String attachmentName = null;
        String attachmentType = null;
        byte[] attachmentBytes = null;
        String attachmentData = text(input, "attachmentData");
        if (attachmentData != null) {
            attachmentBytes = decodeFile(attachmentData);
            attachmentName = fileNameOrDefault(input, "attachmentName");
            attachmentType = typeOrNull(input);
        }

        // ---- transaction: the assignment and its section links are saved together ----
        long newId = 0;
        Connection c = Database.begin();
        try {
            newId = Database.insert(c,
                    "INSERT INTO assignments (course_id, professor_id, title, description, due_date, " +
                    "points, attachment_name, attachment_type, attachment_data) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    courseId, professorId, title, text(input, "desc"), dueDate,
                    points, attachmentName, attachmentType, attachmentBytes);

            saveSections(c, newId, sectionIds);

            Database.commit(c);
        } catch (RuntimeException e) {
            Database.rollback(c);
            throw e;
        } finally {
            Database.close(c);
        }

        return get(newId);
    }

    // PUT /api/assignments/{id}. Returns the updated assignment, or null if it does not exist.
    //
    // About the attachment (the list never sends file data, so the browser's copy has none):
    //   - attachmentData sent -> replace the attachment (name, type, bytes)
    //   - attachmentData missing, attachmentName sent as empty -> remove the attachment
    //   - otherwise -> KEEP the attachment that is already stored
    // About sectionIds: replaced only when the key is sent; otherwise kept as is.
    public static Map<String, Object> update(long id, Map<String, Object> input) {
        if (get(id) == null) {
            return null;
        }

        String title = text(input, "title");
        Integer courseId = number(input, "courseId");
        Integer points = number(input, "points");
        if (title == null || courseId == null) {
            throw new IllegalArgumentException("title and courseId are required");
        }
        if (title.length() > 200) {
            throw new IllegalArgumentException("title is too long (max 200 characters)");
        }
        if (points == null) {
            points = 100;
        }
        if (points < 1) {
            throw new IllegalArgumentException("points must be at least 1");
        }
        Timestamp dueDate = readDueDate(input);

        boolean replaceSections = input.containsKey("sectionIds");
        List<Long> sectionIds = idList(input.get("sectionIds"));
        if (replaceSections && sectionIds.isEmpty()) {
            throw new IllegalArgumentException("Choose at least one section");
        }

        // Build the UPDATE: these columns are always written.
        StringBuilder sql = new StringBuilder(
                "UPDATE assignments SET course_id = ?, title = ?, description = ?, due_date = ?, points = ?");
        List<Object> params = new ArrayList<>();
        params.add(courseId);
        params.add(title);
        params.add(text(input, "desc"));
        params.add(dueDate);
        params.add(points);

        String attachmentData = text(input, "attachmentData");
        if (attachmentData != null) {
            sql.append(", attachment_name = ?, attachment_type = ?, attachment_data = ?");
            params.add(fileNameOrDefault(input, "attachmentName"));
            params.add(typeOrNull(input));
            params.add(decodeFile(attachmentData));
        } else if (input.containsKey("attachmentName") && text(input, "attachmentName") == null) {
            sql.append(", attachment_name = NULL, attachment_type = NULL, attachment_data = NULL");
        }
        // else: leave the stored attachment alone

        sql.append(" WHERE id = ?");
        params.add(id);

        // ---- transaction ----
        Connection c = Database.begin();
        try {
            Database.update(c, sql.toString(), params.toArray());

            if (replaceSections) {
                Database.update(c, "DELETE FROM assignment_sections WHERE assignment_id = ?", id);
                saveSections(c, id, sectionIds);
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

    // DELETE /api/assignments/{id}. Returns rows deleted (0 = not found).
    // Section links and submissions go away by cascade.
    public static int delete(long id) {
        return Database.update("DELETE FROM assignments WHERE id = ?", id);
    }

    // Inserts the rows of assignment_sections. Link tables have no auto id,
    // so we use Database.update, not insert.
    private static void saveSections(Connection c, long assignmentId, List<Long> sectionIds) {
        for (Long sectionId : sectionIds) {
            Database.update(c,
                    "INSERT INTO assignment_sections (assignment_id, section_id) VALUES (?, ?)",
                    assignmentId, sectionId);
        }
    }

    // ==================================================================
    // SUBMISSIONS
    // ==================================================================

    // POST /api/assignments/{id}/submissions (student).
    // The handler first checks the assignment exists and visibleToStudent(...).
    //   - first time        -> inserts a new submission
    //   - sent again        -> REPLACES the old one (note, file, time)
    //   - already graded    -> returns null  (handler answers 409)
    // Returns the submission (no file data).
    public static Map<String, Object> submit(long assignmentId, long studentId, Map<String, Object> input) {
        // Read the file first (decode base64 -> bytes). It is optional.
        String fileName = null;
        byte[] fileBytes = null;
        String fileData = text(input, "fileData");
        if (fileData != null) {
            fileBytes = decodeFile(fileData);
            fileName = fileNameOrDefault(input, "fileName");
        }
        String note = text(input, "note");

        // Did this student already submit?
        Map<String, Object> existing = Database.queryOne(
                "SELECT id, status FROM submissions WHERE assignment_id = ? AND student_id = ?",
                assignmentId, studentId);

        long submissionId;
        if (existing == null) {
            // first submission
            submissionId = Database.insert(
                    "INSERT INTO submissions (assignment_id, student_id, note, file_name, file_data) " +
                    "VALUES (?, ?, ?, ?, ?)",
                    assignmentId, studentId, note, fileName, fileBytes);
        } else {
            // a graded submission can not be replaced
            if ("graded".equals(existing.get("status"))) {
                return null;
            }
            submissionId = ((Number) existing.get("id")).longValue();
            Database.update(
                    "UPDATE submissions SET note = ?, file_name = ?, file_data = ?, " +
                    "status = 'submitted', submitted_at = NOW() WHERE id = ?",
                    note, fileName, fileBytes, submissionId);
        }

        return getSubmission(submissionId);
    }

    // GET /api/assignments/{id}/submissions
    // studentId = null -> every submission of the assignment (professor)
    // studentId = a number -> only that student's submission (student sees own only)
    public static List<Map<String, Object>> listSubmissions(long assignmentId, Long studentId) {
        StringBuilder sql = new StringBuilder(SUBMISSION_SELECT);
        sql.append("WHERE s.assignment_id = ?");
        List<Object> params = new ArrayList<>();
        params.add(assignmentId);

        if (studentId != null) {
            sql.append(" AND s.student_id = ?");
            params.add(studentId);
        }
        sql.append(" ORDER BY u.last_name, u.first_name");

        List<Map<String, Object>> rows = Database.query(sql.toString(), params.toArray());

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(tidySubmission(row));
        }
        return result;
    }

    // One submission (no file data) or null if not found.
    // The handler uses "studentId" (student owner check) and "assignmentId"
    // (then get(assignmentId).professorId for the professor owner check).
    public static Map<String, Object> getSubmission(long id) {
        Map<String, Object> row = Database.queryOne(SUBMISSION_SELECT + "WHERE s.id = ?", id);
        if (row == null) {
            return null;
        }
        return tidySubmission(row);
    }

    // The grade is DECIMAL in the database; send it to the browser as a plain number.
    private static Map<String, Object> tidySubmission(Map<String, Object> row) {
        Map<String, Object> submission = new LinkedHashMap<>(row);
        Object grade = submission.get("grade");
        if (grade instanceof Number) {
            submission.put("grade", ((Number) grade).doubleValue());
        }
        return submission;
    }

    // GET /api/submissions/{id}/file
    // Returns {fileName, fileData} (base64 text, null if no file), or null if not found.
    public static Map<String, Object> getSubmissionFile(long id) {
        Map<String, Object> row = Database.queryOne(
                "SELECT file_name AS fileName, file_data AS fileData FROM submissions WHERE id = ?", id);
        if (row == null) {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fileName", row.get("fileName"));
        result.put("fileData", encodeFile(row.get("fileData")));
        return result;
    }

    // PUT /api/submissions/{id}/grade (professor; the handler checked ownership).
    // input: grade (0 up to the assignment's points), feedback (optional).
    // Sets status 'graded' and graded_at (server time). Grading again just changes the grade.
    // Returns the submission, or null if it does not exist.
    public static Map<String, Object> grade(long submissionId, Map<String, Object> input) {
        // We need the assignment's points to check the grade.
        Map<String, Object> row = Database.queryOne(
                "SELECT a.points AS points FROM submissions s " +
                "JOIN assignments a ON a.id = s.assignment_id WHERE s.id = ?",
                submissionId);
        if (row == null) {
            return null;
        }
        int maxPoints = ((Number) row.get("points")).intValue();

        Double grade = decimal(input, "grade");
        if (grade == null) {
            throw new IllegalArgumentException("grade is required");
        }
        if (grade < 0 || grade > maxPoints) {
            throw new IllegalArgumentException("grade must be between 0 and " + maxPoints);
        }

        Database.update(
                "UPDATE submissions SET grade = ?, feedback = ?, status = 'graded', graded_at = NOW() " +
                "WHERE id = ?",
                grade, text(input, "feedback"), submissionId);

        return getSubmission(submissionId);
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

    // base64 text -> real bytes. A browser "data:...;base64," prefix is cut off first.
    // Not valid base64 -> IllegalArgumentException (handler -> 400).
    private static byte[] decodeFile(String fileData) {
        String s = fileData.trim();
        int comma = s.indexOf(',');
        if (s.startsWith("data:") && comma > 0) {
            s = s.substring(comma + 1);
        }
        return Base64.getDecoder().decode(s);
    }

    // real bytes (from a LONGBLOB column) -> base64 text. null stays null.
    private static String encodeFile(Object value) {
        if (value == null) {
            return null;
        }
        byte[] bytes;
        if (value instanceof byte[]) {
            bytes = (byte[]) value;
        } else if (value instanceof Blob) {
            try {
                Blob blob = (Blob) value;
                bytes = blob.getBytes(1, (int) blob.length());
            } catch (SQLException e) {
                throw new RuntimeException("Could not read the file", e);
            }
        } else {
            throw new RuntimeException("Unexpected file column type");
        }
        return Base64.getEncoder().encodeToString(bytes);
    }

    // The file name that goes with a new file (the columns hold 255 characters).
    private static String fileNameOrDefault(Map<String, Object> input, String key) {
        String name = text(input, key);
        if (name == null) {
            return "file";
        }
        if (name.length() > 255) {
            throw new IllegalArgumentException(key + " is too long (max 255 characters)");
        }
        return name;
    }

    // attachmentType (for example "application/pdf"); the column holds 100 characters.
    private static String typeOrNull(Map<String, Object> input) {
        String type = text(input, "attachmentType");
        if (type != null && type.length() > 100) {
            throw new IllegalArgumentException("attachmentType is too long (max 100 characters)");
        }
        return type;
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

    // Number with decimals from the input (a grade like 87.5). null when missing.
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
}
