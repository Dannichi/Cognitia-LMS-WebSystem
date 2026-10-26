package data;

// ============================================================================
// AcademicData.java  (folder: backend/rcs/data/)
//
// Covers tables : programs, sections, courses,
//                 course_programs, section_courses, teaching_assignments
// Used by       : AcademicHandler (/api/programs, /api/sections, /api/courses)
//                 and the lesson / assignment / quiz handlers (teachesCourse,
//                 teachesSection checks at the bottom of this file)
//
// Rules for this file:
//  - This is the ONLY place with SQL about the academic structure.
//  - PUT = full save: every field is written. The browser sends the whole
//    record (api.js diff sends changed records in full).
//  - Saving a section or course REPLACES its link rows with the lists sent.
//  - Saves that touch several tables run in ONE transaction (all or nothing).
//  - Bad input -> IllegalArgumentException (handler -> 400).
//  - Duplicate code / duplicate section -> the database throws (handler -> 409).
//  - Foreign key problems (unknown programId, courseId ...) also throw
//    (handler checks Database.isForeignKeyError).
// ============================================================================

import util.Database;

import java.sql.Connection;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AcademicData {

    // "desc" is a reserved word in SQL, so the alias is written with backticks.
    private static final String PROGRAM_COLUMNS =
            "id, code, name, description AS `desc`, status, color, " +
            "catalog_id AS catalogId, department_id AS departmentId, campus_id AS campusId";

    private static final String SECTION_COLUMNS =
            "id, program_id AS programId, year, letter, capacity";

    private static final String COURSE_COLUMNS =
            "id, code, name, semester, units, status";

    // ==================================================================
    // PROGRAMS   (table: programs)
    // ==================================================================

    // GET /api/programs (public): all programs.
    public static List<Map<String, Object>> listPrograms() {
        return Database.query("SELECT " + PROGRAM_COLUMNS + " FROM programs ORDER BY code");
    }

    // One program by id, or null if not found.
    public static Map<String, Object> getProgram(long id) {
        return Database.queryOne("SELECT " + PROGRAM_COLUMNS + " FROM programs WHERE id = ?", id);
    }

    // POST /api/programs (admin). Returns the new program.
    public static Map<String, Object> createProgram(Map<String, Object> input) {
        String code = text(input, "code");
        String name = text(input, "name");
        String status = statusOrDefault(input);
        if (code == null || name == null) {
            throw new IllegalArgumentException("code and name are required");
        }

        long newId = Database.insert(
                "INSERT INTO programs (code, name, description, status, color, " +
                "catalog_id, department_id, campus_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                code, name, text(input, "desc"), status, text(input, "color"),
                text(input, "catalogId"), text(input, "departmentId"), text(input, "campusId"));

        return getProgram(newId);
    }

    // PUT /api/programs/{id} (admin). Returns the updated program, or null if not found.
    public static Map<String, Object> updateProgram(long id, Map<String, Object> input) {
        if (getProgram(id) == null) {
            return null;
        }
        String code = text(input, "code");
        String name = text(input, "name");
        String status = statusOrDefault(input);
        if (code == null || name == null) {
            throw new IllegalArgumentException("code and name are required");
        }

        Database.update(
                "UPDATE programs SET code = ?, name = ?, description = ?, status = ?, color = ?, " +
                "catalog_id = ?, department_id = ?, campus_id = ? WHERE id = ?",
                code, name, text(input, "desc"), status, text(input, "color"),
                text(input, "catalogId"), text(input, "departmentId"), text(input, "campusId"), id);

        return getProgram(id);
    }

    // DELETE /api/programs/{id} (admin). Returns rows deleted (0 = not found).
    // If sections still belong to the program the database refuses (foreign key error).
    public static int deleteProgram(long id) {
        return Database.update("DELETE FROM programs WHERE id = ?", id);
    }

    // ==================================================================
    // SECTIONS   (tables: sections, section_courses, teaching_assignments)
    // ==================================================================

    // GET /api/sections (public): every section with its links filled in.
    public static List<Map<String, Object>> listSections() {
        List<Map<String, Object>> rows =
                Database.query("SELECT " + SECTION_COLUMNS + " FROM sections ORDER BY program_id, year, letter");

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(withSectionLinks(row));
        }
        return result;
    }

    // One section (with links) or null if not found.
    public static Map<String, Object> getSection(long id) {
        Map<String, Object> row =
                Database.queryOne("SELECT " + SECTION_COLUMNS + " FROM sections WHERE id = ?", id);
        if (row == null) {
            return null;
        }
        return withSectionLinks(row);
    }

    // Adds "courseIds" and "professorAssignments" to a section row.
    private static Map<String, Object> withSectionLinks(Map<String, Object> row) {
        // Copy the row so we are sure we can add keys to it.
        Map<String, Object> section = new LinkedHashMap<>(row);
        long sectionId = ((Number) row.get("id")).longValue();

        // ---- courseIds: [1, 2, 3] ----
        List<Map<String, Object>> courseRows = Database.query(
                "SELECT course_id AS courseId FROM section_courses WHERE section_id = ? ORDER BY course_id",
                sectionId);
        List<Object> courseIds = new ArrayList<>();
        for (Map<String, Object> r : courseRows) {
            courseIds.add(r.get("courseId"));
        }
        section.put("courseIds", courseIds);

        // ---- professorAssignments: [{professorId, courseIds[]}] ----
        // The table has one row per (professor, course). We group the rows by professor.
        List<Map<String, Object>> links = Database.query(
                "SELECT professor_id AS professorId, course_id AS courseId " +
                "FROM teaching_assignments WHERE section_id = ? ORDER BY professor_id, course_id",
                sectionId);

        Map<Long, List<Object>> coursesByProfessor = new LinkedHashMap<>();
        for (Map<String, Object> link : links) {
            Long professorId = ((Number) link.get("professorId")).longValue();
            if (!coursesByProfessor.containsKey(professorId)) {
                coursesByProfessor.put(professorId, new ArrayList<>());
            }
            coursesByProfessor.get(professorId).add(link.get("courseId"));
        }

        List<Map<String, Object>> assignments = new ArrayList<>();
        for (Map.Entry<Long, List<Object>> entry : coursesByProfessor.entrySet()) {
            Map<String, Object> a = new LinkedHashMap<>();
            a.put("professorId", entry.getKey());
            a.put("courseIds", entry.getValue());
            assignments.add(a);
        }
        section.put("professorAssignments", assignments);

        return section;
    }

    // POST /api/sections (admin). Section + its links saved in ONE transaction.
    public static Map<String, Object> createSection(Map<String, Object> input) {
        // ---- validate and read the input BEFORE touching the database ----
        Integer programId = number(input, "programId");
        Integer year = number(input, "year");
        String letter = text(input, "letter");
        Integer capacity = number(input, "capacity");
        checkSectionFields(programId, year, letter, capacity);
        if (capacity == null) {
            capacity = 40; // same default as the table
        }
        letter = letter.toUpperCase();

        List<Long> courseIds = idList(input.get("courseIds"));
        List<Map<String, Object>> assignments = mapList(input.get("professorAssignments"));

        // ---- transaction ----
        long newId = 0;
        Connection c = Database.begin();
        try {
            newId = Database.insert(c,
                    "INSERT INTO sections (program_id, year, letter, capacity) VALUES (?, ?, ?, ?)",
                    programId, year, letter, capacity);

            saveSectionLinks(c, newId, courseIds, assignments);

            Database.commit(c);
        } catch (RuntimeException e) {
            Database.rollback(c); // undo everything if any step failed
            throw e;
        } finally {
            Database.close(c);
        }

        return getSection(newId);
    }

    // PUT /api/sections/{id} (admin). Replaces the section's links with the lists sent.
    // Returns the updated section, or null if the id does not exist.
    public static Map<String, Object> updateSection(long id, Map<String, Object> input) {
        if (getSection(id) == null) {
            return null;
        }

        Integer programId = number(input, "programId");
        Integer year = number(input, "year");
        String letter = text(input, "letter");
        Integer capacity = number(input, "capacity");
        checkSectionFields(programId, year, letter, capacity);
        if (capacity == null) {
            capacity = 40;
        }
        letter = letter.toUpperCase();

        List<Long> courseIds = idList(input.get("courseIds"));
        List<Map<String, Object>> assignments = mapList(input.get("professorAssignments"));

        Connection c = Database.begin();
        try {
            Database.update(c,
                    "UPDATE sections SET program_id = ?, year = ?, letter = ?, capacity = ? WHERE id = ?",
                    programId, year, letter, capacity, id);

            // Remove the old links. teaching_assignments first, because it
            // has a foreign key to section_courses.
            Database.update(c, "DELETE FROM teaching_assignments WHERE section_id = ?", id);
            Database.update(c, "DELETE FROM section_courses WHERE section_id = ?", id);

            // Insert the new links.
            saveSectionLinks(c, id, courseIds, assignments);

            Database.commit(c);
        } catch (RuntimeException e) {
            Database.rollback(c);
            throw e;
        } finally {
            Database.close(c);
        }

        return getSection(id);
    }

    // DELETE /api/sections/{id} (admin). The database removes the link rows by itself (cascade).
    public static int deleteSection(long id) {
        return Database.update("DELETE FROM sections WHERE id = ?", id);
    }

    // Inserts the link rows of one section, in this order:
    //   1) section_courses      2) teaching_assignments
    // (teaching_assignments has a foreign key to section_courses, so order matters)
    // Link tables have no auto id, so we use Database.update, not insert.
    private static void saveSectionLinks(Connection c, long sectionId,
                                         List<Long> courseIds,
                                         List<Map<String, Object>> assignments) {
        // 1) which courses the section takes
        for (Long courseId : courseIds) {
            Database.update(c,
                    "INSERT INTO section_courses (section_id, course_id) VALUES (?, ?)",
                    sectionId, courseId);
        }

        // 2) which professor teaches which course in this section
        for (Map<String, Object> assignment : assignments) {
            Integer professorId = number(assignment, "professorId");
            if (professorId == null) {
                throw new IllegalArgumentException("professorId is required in professorAssignments");
            }
            for (Long courseId : idList(assignment.get("courseIds"))) {
                Database.update(c,
                        "INSERT INTO teaching_assignments (section_id, course_id, professor_id) VALUES (?, ?, ?)",
                        sectionId, courseId, professorId);
            }
        }
    }

    private static void checkSectionFields(Integer programId, Integer year, String letter, Integer capacity) {
        if (programId == null || year == null || letter == null) {
            throw new IllegalArgumentException("programId, year and letter are required");
        }
        if (year < 1 || year > 4) {
            throw new IllegalArgumentException("year must be between 1 and 4");
        }
        if (letter.length() != 1) {
            throw new IllegalArgumentException("letter must be one character");
        }
        if (capacity != null && capacity < 1) {
            throw new IllegalArgumentException("capacity must be at least 1");
        }
    }

    // ==================================================================
    // COURSES   (tables: courses, course_programs)
    // ==================================================================

    // GET /api/courses. What you get depends on the role:
    //   admin     -> all courses
    //   professor -> courses they teach (from teaching_assignments)
    //   student   -> active courses of their own program
    // Every course gets its "programs" list filled in.
    public static List<Map<String, Object>> listCourses(String role, long userId) {
        List<Map<String, Object>> rows;

        if ("admin".equals(role)) {
            rows = Database.query("SELECT " + COURSE_COLUMNS + " FROM courses ORDER BY code");

        } else if ("professor".equals(role)) {
            rows = Database.query(
                    "SELECT DISTINCT c.id, c.code, c.name, c.semester, c.units, c.status " +
                    "FROM courses c " +
                    "JOIN teaching_assignments t ON t.course_id = c.id " +
                    "WHERE t.professor_id = ? ORDER BY c.code",
                    userId);

        } else if ("student".equals(role)) {
            rows = Database.query(
                    "SELECT DISTINCT c.id, c.code, c.name, c.semester, c.units, c.status " +
                    "FROM courses c " +
                    "JOIN course_programs cp ON cp.course_id = c.id " +
                    "JOIN users u ON u.program_id = cp.program_id " +
                    "WHERE u.id = ? AND c.status = 'active' ORDER BY c.code",
                    userId);

        } else {
            throw new IllegalArgumentException("Unknown role");
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(withCoursePrograms(row));
        }
        return result;
    }

    // One course (with programs) or null if not found.
    public static Map<String, Object> getCourse(long id) {
        Map<String, Object> row =
                Database.queryOne("SELECT " + COURSE_COLUMNS + " FROM courses WHERE id = ?", id);
        if (row == null) {
            return null;
        }
        return withCoursePrograms(row);
    }

    // Adds "programs": [{programId, year}] to a course row.
    private static Map<String, Object> withCoursePrograms(Map<String, Object> row) {
        Map<String, Object> course = new LinkedHashMap<>(row);
        long courseId = ((Number) row.get("id")).longValue();

        course.put("programs", Database.query(
                "SELECT program_id AS programId, year FROM course_programs " +
                "WHERE course_id = ? ORDER BY program_id",
                courseId));
        return course;
    }

    // POST /api/courses (admin). Course + its program links in ONE transaction.
    public static Map<String, Object> createCourse(Map<String, Object> input) {
        String code = text(input, "code");
        String name = text(input, "name");
        String status = statusOrDefault(input);
        if (code == null || name == null) {
            throw new IllegalArgumentException("code and name are required");
        }
        List<Map<String, Object>> programs = mapList(input.get("programs"));

        long newId = 0;
        Connection c = Database.begin();
        try {
            newId = Database.insert(c,
                    "INSERT INTO courses (code, name, semester, units, status) VALUES (?, ?, ?, ?, ?)",
                    code, name, number(input, "semester"), number(input, "units"), status);

            saveCoursePrograms(c, newId, programs);

            Database.commit(c);
        } catch (RuntimeException e) {
            Database.rollback(c);
            throw e;
        } finally {
            Database.close(c);
        }

        return getCourse(newId);
    }

    // PUT /api/courses/{id} (admin). Replaces the course's program links.
    // Returns the updated course, or null if the id does not exist.
    public static Map<String, Object> updateCourse(long id, Map<String, Object> input) {
        if (getCourse(id) == null) {
            return null;
        }
        String code = text(input, "code");
        String name = text(input, "name");
        String status = statusOrDefault(input);
        if (code == null || name == null) {
            throw new IllegalArgumentException("code and name are required");
        }
        List<Map<String, Object>> programs = mapList(input.get("programs"));

        Connection c = Database.begin();
        try {
            Database.update(c,
                    "UPDATE courses SET code = ?, name = ?, semester = ?, units = ?, status = ? WHERE id = ?",
                    code, name, number(input, "semester"), number(input, "units"), status, id);

            Database.update(c, "DELETE FROM course_programs WHERE course_id = ?", id);
            saveCoursePrograms(c, id, programs);

            Database.commit(c);
        } catch (RuntimeException e) {
            Database.rollback(c);
            throw e;
        } finally {
            Database.close(c);
        }

        return getCourse(id);
    }

    // DELETE /api/courses/{id} (admin). Link rows go away by cascade.
    public static int deleteCourse(long id) {
        return Database.update("DELETE FROM courses WHERE id = ?", id);
    }

    // Inserts the rows of "programs": [{programId, year}] for one course.
    private static void saveCoursePrograms(Connection c, long courseId, List<Map<String, Object>> programs) {
        for (Map<String, Object> p : programs) {
            Integer programId = number(p, "programId");
            if (programId == null) {
                throw new IllegalArgumentException("programId is required in programs");
            }
            Database.update(c,
                    "INSERT INTO course_programs (course_id, program_id, year) VALUES (?, ?, ?)",
                    courseId, programId, number(p, "year"));
        }
    }

    // ==================================================================
    // "Does this professor teach it?"  (used by lesson / assignment / quiz handlers)
    // ==================================================================

    // true if the professor teaches this course in at least one section.
    public static boolean teachesCourse(long professorId, long courseId) {
        Map<String, Object> row = Database.queryOne(
                "SELECT 1 AS found FROM teaching_assignments " +
                "WHERE professor_id = ? AND course_id = ? LIMIT 1",
                professorId, courseId);
        return row != null;
    }

    // true if the professor teaches this course in this specific section.
    public static boolean teachesSection(long professorId, long courseId, long sectionId) {
        Map<String, Object> row = Database.queryOne(
                "SELECT 1 AS found FROM teaching_assignments " +
                "WHERE professor_id = ? AND course_id = ? AND section_id = ? LIMIT 1",
                professorId, courseId, sectionId);
        return row != null;
    }

    // ==================================================================
    // Small private helpers (only used inside this file)
    // ==================================================================

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

    // Reads "status" ('active' / 'inactive'). Missing -> 'active'.
    private static String statusOrDefault(Map<String, Object> input) {
        String status = text(input, "status");
        if (status == null) {
            return "active";
        }
        if (!"active".equals(status) && !"inactive".equals(status)) {
            throw new IllegalArgumentException("status must be active or inactive");
        }
        return status;
    }

    // Turns a JSON list of numbers ([1, 2, 3]) into a List<Long>. Missing -> empty list.
    // Repeated ids are kept only once.
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

    // Turns a JSON list of objects into a List of Maps. Missing -> empty list.
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
