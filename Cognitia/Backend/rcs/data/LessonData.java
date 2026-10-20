package data;

// ============================================================================
// LessonData.java  (folder: backend/rcs/data/)
//
// Covers tables : lessons, lesson_sections, lesson_progress
// Used by       : LessonHandler
//                 (/api/lessons[/{id}], /api/lessons/{id}/file, /api/lessons/{id}/done)
//
// Rules for this file:
//  - This is the ONLY place with SQL about lessons.
//  - FILES: the browser sends the file as base64 TEXT (fileData). We DECODE it
//    and store the real bytes in the LONGBLOB column. When a file is requested
//    we encode the bytes back to base64 text. List replies never contain file data.
//  - Ownership checks ("is this your lesson?", "do you teach that section?") are
//    done by the HANDLER. This class gives it what it needs:
//      get(id).professorId, visibleToStudent(...), AcademicData.teachesSection(...)
//  - Bad input -> IllegalArgumentException (handler -> 400).
// ============================================================================

import util.Database;

import java.sql.Blob;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class LessonData {

    // Columns sent to the browser. file_data is NOT here on purpose (lists stay small).
    // "desc" is a reserved SQL word, so the alias is written with backticks.
    private static final String COLUMNS =
            "l.id, " +
            "l.course_id AS courseId, " +
            "l.professor_id AS professorId, " +
            "l.title, " +
            "l.description AS `desc`, " +
            "l.file_name AS fileName, " +
            "l.created_at AS createdAt";

    // ==================================================================
    // READ
    // ==================================================================

    // GET /api/lessons?courseId=   (courseId may be null = all courses)
    //   professor -> the lessons they created
    //   student   -> lessons given to THEIR section, each with "done" true/false
    public static List<Map<String, Object>> list(String role, long userId, Long courseId) {
        StringBuilder sql = new StringBuilder();
        List<Object> params = new ArrayList<>();

        if ("professor".equals(role)) {
            sql.append("SELECT ").append(COLUMNS)
               .append(" FROM lessons l WHERE l.professor_id = ?");
            params.add(userId);

        } else if ("student".equals(role)) {
            // lessons -> lesson_sections -> the student's own section.
            // LEFT JOIN lesson_progress tells us if this student marked it done.
            sql.append("SELECT ").append(COLUMNS).append(", p.done_at AS doneAt")
               .append(" FROM lessons l")
               .append(" JOIN lesson_sections ls ON ls.lesson_id = l.id")
               .append(" JOIN users u ON u.section_id = ls.section_id")
               .append(" LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.student_id = u.id")
               .append(" WHERE u.id = ?");
            params.add(userId);

        } else {
            throw new IllegalArgumentException("Only professors and students have lessons");
        }

        if (courseId != null) {
            sql.append(" AND l.course_id = ?");
            params.add(courseId);
        }
        sql.append(" ORDER BY l.created_at DESC, l.id DESC");

        List<Map<String, Object>> rows = Database.query(sql.toString(), params.toArray());

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(tidy(row));
        }
        return result;
    }

    // One lesson (with sectionIds, no file data) or null if not found.
    // The handler uses its "professorId" for the "is this your lesson?" check.
    public static Map<String, Object> get(long id) {
        Map<String, Object> row = Database.queryOne(
                "SELECT " + COLUMNS + " FROM lessons l WHERE l.id = ?", id);
        if (row == null) {
            return null;
        }
        return tidy(row);
    }

    // Cleans one row: adds "sectionIds" and, for students, turns "doneAt" into "done".
    private static Map<String, Object> tidy(Map<String, Object> row) {
        Map<String, Object> lesson = new LinkedHashMap<>(row); // copy so we can add keys
        long lessonId = ((Number) row.get("id")).longValue();

        // sectionIds: [1, 2]
        List<Map<String, Object>> links = Database.query(
                "SELECT section_id AS sectionId FROM lesson_sections WHERE lesson_id = ? ORDER BY section_id",
                lessonId);
        List<Object> sectionIds = new ArrayList<>();
        for (Map<String, Object> link : links) {
            sectionIds.add(link.get("sectionId"));
        }
        lesson.put("sectionIds", sectionIds);

        // Only the student query has "doneAt"
        if (lesson.containsKey("doneAt")) {
            lesson.put("done", lesson.get("doneAt") != null);
            lesson.remove("doneAt");
        }
        return lesson;
    }

    // GET /api/lessons/{id}/file
    // Returns {fileName, fileData} (fileData is base64 text, null if the lesson has no file),
    // or null if the lesson does not exist.
    public static Map<String, Object> getFile(long id) {
        Map<String, Object> row = Database.queryOne(
                "SELECT file_name AS fileName, file_data AS fileData FROM lessons WHERE id = ?", id);
        if (row == null) {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fileName", row.get("fileName"));
        result.put("fileData", encodeFile(row.get("fileData")));
        return result;
    }

    // true if this lesson was given to the student's own section.
    public static boolean visibleToStudent(long lessonId, long studentId) {
        Map<String, Object> row = Database.queryOne(
                "SELECT 1 AS found FROM lesson_sections ls " +
                "JOIN users u ON u.section_id = ls.section_id " +
                "WHERE ls.lesson_id = ? AND u.id = ? LIMIT 1",
                lessonId, studentId);
        return row != null;
    }

    // ==================================================================
    // CREATE / UPDATE / DELETE  (professor; the handler checks ownership)
    // ==================================================================

    // POST /api/lessons. professorId = the logged-in professor. Returns the new lesson.
    public static Map<String, Object> create(long professorId, Map<String, Object> input) {
        // ---- validate and read the input BEFORE touching the database ----
        String title = text(input, "title");
        Integer courseId = number(input, "courseId");
        List<Long> sectionIds = idList(input.get("sectionIds"));

        if (title == null || courseId == null) {
            throw new IllegalArgumentException("title and courseId are required");
        }
        if (title.length() > 200) {
            throw new IllegalArgumentException("title is too long (max 200 characters)");
        }
        if (sectionIds.isEmpty()) {
            throw new IllegalArgumentException("Choose at least one section");
        }

        // The file is optional. Decode the base64 text to real bytes.
        String fileName = null;
        byte[] fileBytes = null;
        String fileData = text(input, "fileData");
        if (fileData != null) {
            fileBytes = decodeFile(fileData);
            fileName = fileNameOrDefault(input);
        }

        // ---- transaction: the lesson and its section links are saved together ----
        long newId = 0;
        Connection c = Database.begin();
        try {
            newId = Database.insert(c,
                    "INSERT INTO lessons (course_id, professor_id, title, description, file_name, file_data) " +
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    courseId, professorId, title, text(input, "desc"), fileName, fileBytes);

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

    // PUT /api/lessons/{id}. Returns the updated lesson, or null if it does not exist.
    //
    // About the file (the list never sends file data, so the browser's copy has none):
    //   - fileData sent            -> replace the file (name + bytes)
    //   - fileData missing, fileName sent as empty -> remove the file
    //   - otherwise                -> KEEP the file that is already stored
    // About sectionIds: replaced only when the key is sent; otherwise kept as is.
    public static Map<String, Object> update(long id, Map<String, Object> input) {
        if (get(id) == null) {
            return null;
        }

        String title = text(input, "title");
        Integer courseId = number(input, "courseId");
        if (title == null || courseId == null) {
            throw new IllegalArgumentException("title and courseId are required");
        }
        if (title.length() > 200) {
            throw new IllegalArgumentException("title is too long (max 200 characters)");
        }

        boolean replaceSections = input.containsKey("sectionIds");
        List<Long> sectionIds = idList(input.get("sectionIds"));
        if (replaceSections && sectionIds.isEmpty()) {
            throw new IllegalArgumentException("Choose at least one section");
        }

        // Build the UPDATE: the first three columns are always written.
        StringBuilder sql = new StringBuilder("UPDATE lessons SET course_id = ?, title = ?, description = ?");
        List<Object> params = new ArrayList<>();
        params.add(courseId);
        params.add(title);
        params.add(text(input, "desc"));

        String fileData = text(input, "fileData");
        if (fileData != null) {
            // new file -> replace name and bytes
            sql.append(", file_name = ?, file_data = ?");
            params.add(fileNameOrDefault(input));
            params.add(decodeFile(fileData));
        } else if (input.containsKey("fileName") && text(input, "fileName") == null) {
            // fileName sent but empty -> the professor removed the file
            sql.append(", file_name = NULL, file_data = NULL");
        }
        // else: leave the stored file alone

        sql.append(" WHERE id = ?");
        params.add(id);

        // ---- transaction ----
        Connection c = Database.begin();
        try {
            Database.update(c, sql.toString(), params.toArray());

            if (replaceSections) {
                Database.update(c, "DELETE FROM lesson_sections WHERE lesson_id = ?", id);
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

    // DELETE /api/lessons/{id}. Returns rows deleted (0 = not found).
    // Section links and "done" marks go away by cascade.
    public static int delete(long id) {
        return Database.update("DELETE FROM lessons WHERE id = ?", id);
    }

    // Inserts the rows of lesson_sections. Link tables have no auto id,
    // so we use Database.update, not insert.
    private static void saveSections(Connection c, long lessonId, List<Long> sectionIds) {
        for (Long sectionId : sectionIds) {
            Database.update(c,
                    "INSERT INTO lesson_sections (lesson_id, section_id) VALUES (?, ?)",
                    lessonId, sectionId);
        }
    }

    // ==================================================================
    // DONE / NOT DONE  (students)
    // ==================================================================

    // POST /api/lessons/{id}/done. INSERT IGNORE: marking twice is not an error.
    // The handler first checks the lesson exists and visibleToStudent(...).
    public static void markDone(long studentId, long lessonId) {
        Database.update(
                "INSERT IGNORE INTO lesson_progress (student_id, lesson_id) VALUES (?, ?)",
                studentId, lessonId);
    }

    // DELETE /api/lessons/{id}/done.
    public static void unmarkDone(long studentId, long lessonId) {
        Database.update(
                "DELETE FROM lesson_progress WHERE student_id = ? AND lesson_id = ?",
                studentId, lessonId);
    }

    // ==================================================================
    // Small private helpers (only used inside this file)
    // ==================================================================

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

    // The file name that goes with a new file (the column holds 255 characters).
    private static String fileNameOrDefault(Map<String, Object> input) {
        String name = text(input, "fileName");
        if (name == null) {
            return "file";
        }
        if (name.length() > 255) {
            throw new IllegalArgumentException("fileName is too long (max 255 characters)");
        }
        return name;
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
