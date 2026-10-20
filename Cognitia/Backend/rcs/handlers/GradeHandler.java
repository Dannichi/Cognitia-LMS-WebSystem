package handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import data.AcademicData;
import data.AssignmentData;
import data.QuizData;
import data.UserData;
import util.Auth;
import util.Database;
import util.Reply;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * GradeHandler: GET /api/grades?courseId={id}
 * Tables used through data classes: users, teaching_assignments, assignments,
 * submissions, quizzes, quiz_questions, quiz_attempts, and quiz_answers.
 * Main must register this handler on "/api/grades".
 * Grades are calculated when requested; this handler does not save them.
 */
public class GradeHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws IOException {
        if (Reply.handlePreflight(ex)) return;

        try {
            if (!"GET".equals(ex.getRequestMethod())) {
                Reply.error(ex, 404, "Not found");
                return;
            }

            listGrades(ex);
        } catch (Exception e) {
            fail(ex, e);
        }
    }

    // GET /api/grades?courseId= (professor: students in own sections; student: self)
    private void listGrades(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "professor", "student");
        if (session == null) return;

        Long requestedCourseId = requiredCourseId(ex);
        if (requestedCourseId == null) return;
        long courseId = requestedCourseId;

        if ("professor".equals(session.role)) {
            if (!AcademicData.teachesCourse(session.userId, courseId)) {
                Reply.error(ex, 403, "You do not teach this course");
                return;
            }
        } else if (!studentHasCourse(session.userId, courseId)) {
            Reply.error(ex, 403, "This course is not available to this student");
            return;
        }

        List<Map<String, Object>> students = studentsForCourse(session, courseId);
        Map<Long, List<Double>> assignmentScores = new LinkedHashMap<>();
        Map<Long, List<Double>> quizScores = new LinkedHashMap<>();

        for (Map<String, Object> student : students) {
            long studentId = number(student.get("id"), "student id").longValue();
            assignmentScores.put(studentId, new ArrayList<Double>());
            quizScores.put(studentId, new ArrayList<Double>());
        }

        addAssignmentScores(session, courseId, assignmentScores);
        addQuizScores(session, courseId, quizScores);

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> student : students) {
            long studentId = number(student.get("id"), "student id").longValue();
            Double assignmentGrade = average(assignmentScores.get(studentId));
            Double quizScore = average(quizScores.get(studentId));

            double assignmentValue = assignmentGrade == null ? 0.0 : assignmentGrade;
            double quizValue = quizScore == null ? 0.0 : quizScore;
            Double finalGrade = assignmentValue + quizValue == 0.0
                    ? null
                    : roundTwo((assignmentValue + quizValue) / 2.0);

            Map<String, Object> grade = new LinkedHashMap<>();
            grade.put("studentId", studentId);
            grade.put("studentName", fullName(student));
            grade.put("courseId", courseId);
            if ("professor".equals(session.role)) {
                grade.put("professorId", session.userId);
            }
            grade.put("assignmentGrade", assignmentGrade == null ? null : roundTwo(assignmentGrade));
            grade.put("quizScore", quizScore == null ? null : roundTwo(quizScore));
            grade.put("finalGrade", finalGrade);
            result.add(grade);
        }

        Reply.ok(ex, result);
    }

    // courseId is required by the API contract.
    private Long requiredCourseId(HttpExchange ex) throws IOException {
        String value = Reply.queryParam(ex, "courseId");
        if (value == null || value.trim().isEmpty()) {
            Reply.error(ex, 400, "courseId is required");
            return null;
        }

        try {
            long courseId = Long.parseLong(value.trim());
            if (courseId <= 0) throw new NumberFormatException();
            return courseId;
        } catch (NumberFormatException e) {
            Reply.error(ex, 400, "courseId must be a positive number");
            return null;
        }
    }

    // A student may request grades only for an active course in their program.
    private boolean studentHasCourse(long studentId, long courseId) {
        List<Map<String, Object>> courses = AcademicData.listCourses("student", studentId);
        for (Map<String, Object> course : courses) {
            Object id = course.get("id");
            if (id instanceof Number && ((Number) id).longValue() == courseId) {
                return true;
            }
        }
        return false;
    }

    // The data methods already limit assignments and quizzes to the caller.
    // For a professor, include only students in sections where they teach this course.
    private List<Map<String, Object>> studentsForCourse(Auth.Session session, long courseId) {
        List<Map<String, Object>> result = new ArrayList<>();

        if ("student".equals(session.role)) {
            Map<String, Object> student = UserData.getById(session.userId);
            if (student != null) result.add(student);
            return result;
        }

        for (Map<String, Object> student : UserData.list("student", null)) {
            Object sectionValue = student.get("sectionId");
            if (!(sectionValue instanceof Number)) continue;

            long sectionId = ((Number) sectionValue).longValue();
            if (AcademicData.teachesSection(session.userId, courseId, sectionId)) {
                result.add(student);
            }
        }
        return result;
    }

    private void addAssignmentScores(Auth.Session session, long courseId,
                                     Map<Long, List<Double>> scoresByStudent) {
        List<Map<String, Object>> assignments =
                AssignmentData.list(session.role, session.userId, courseId);
        Long onlyStudentId = "student".equals(session.role) ? session.userId : null;

        for (Map<String, Object> assignment : assignments) {
            Double points = decimal(assignment.get("points"));
            if (points == null || points <= 0.0) continue;

            long assignmentId = number(assignment.get("id"), "assignment id").longValue();
            List<Map<String, Object>> submissions =
                    AssignmentData.listSubmissions(assignmentId, onlyStudentId);

            for (Map<String, Object> submission : submissions) {
                Double grade = decimal(submission.get("grade"));
                if (grade == null) continue; // not graded yet

                Long studentId = id(submission.get("studentId"));
                List<Double> studentScores = scoresByStudent.get(studentId);
                if (studentScores != null) {
                    studentScores.add((grade / points) * 100.0);
                }
            }
        }
    }

    private void addQuizScores(Auth.Session session, long courseId,
                               Map<Long, List<Double>> scoresByStudent) {
        List<Map<String, Object>> quizzes = QuizData.list(session.role, session.userId, courseId);
        Long onlyStudentId = "student".equals(session.role) ? session.userId : null;

        for (Map<String, Object> quiz : quizzes) {
            long quizId = number(quiz.get("id"), "quiz id").longValue();
            List<Map<String, Object>> attempts = QuizData.listAttempts(quizId, onlyStudentId);

            for (Map<String, Object> attempt : attempts) {
                Long studentId = id(attempt.get("studentId"));
                List<Double> studentScores = scoresByStudent.get(studentId);
                if (studentScores == null) continue;

                Double percent = quizPercent(quiz, attempt);
                if (percent != null) {
                    // The existing front end stores quiz percentages to one decimal place.
                    studentScores.add(roundOne(percent));
                }
            }
        }
    }

    // While any essay is ungraded, use only the auto-graded questions and their
    // possible points. Once every essay is graded, use the full quiz percentage.
    private Double quizPercent(Map<String, Object> quiz, Map<String, Object> attempt) {
        List<Map<String, Object>> questions = mapList(quiz.get("questions"));
        List<Map<String, Object>> answers = mapList(attempt.get("answers"));
        Map<Long, Map<String, Object>> answersByQuestion = new LinkedHashMap<>();
        for (Map<String, Object> answer : answers) {
            Long questionId = id(answer.get("questionId"));
            if (questionId != null) answersByQuestion.put(questionId, answer);
        }

        boolean hasPendingEssay = false;
        double automaticEarned = 0.0;
        double automaticPossible = 0.0;
        double allEarned = 0.0;
        double allPossible = 0.0;

        for (Map<String, Object> question : questions) {
            Long questionId = id(question.get("id"));
            Double points = decimal(question.get("points"));
            if (points == null || points <= 0.0) continue;

            boolean essay = "essay".equalsIgnoreCase(String.valueOf(question.get("type")));
            Map<String, Object> answer = questionId == null ? null : answersByQuestion.get(questionId);
            Double awarded = answer == null ? null : decimal(answer.get("pointsAwarded"));

            allPossible += points;
            if (awarded != null) allEarned += awarded;

            if (essay) {
                if (awarded == null) hasPendingEssay = true;
            } else {
                automaticPossible += points;
                if (awarded != null) automaticEarned += awarded;
            }
        }

        if (hasPendingEssay) {
            if (automaticPossible <= 0.0) return null;
            return (automaticEarned / automaticPossible) * 100.0;
        }
        if (allPossible <= 0.0) return null;
        return (allEarned / allPossible) * 100.0;
    }

    private static Double average(List<Double> values) {
        if (values == null || values.isEmpty()) return null;
        double total = 0.0;
        for (Double value : values) total += value;
        return total / values.size();
    }

    private static List<Map<String, Object>> mapList(Object value) {
        List<Map<String, Object>> result = new ArrayList<>();
        if (!(value instanceof List<?>)) return result;

        for (Object item : (List<?>) value) {
            if (item instanceof Map<?, ?>) {
                @SuppressWarnings("unchecked")
                Map<String, Object> map = (Map<String, Object>) item;
                result.add(map);
            }
        }
        return result;
    }

    private static Long id(Object value) {
        return value instanceof Number ? ((Number) value).longValue() : null;
    }

    private static Number number(Object value, String field) {
        if (!(value instanceof Number)) {
            throw new IllegalArgumentException(field + " is missing");
        }
        return (Number) value;
    }

    private static Double decimal(Object value) {
        return value instanceof Number ? ((Number) value).doubleValue() : null;
    }

    private static String fullName(Map<String, Object> student) {
        String first = student.get("firstname") == null ? "" : String.valueOf(student.get("firstname"));
        String last = student.get("lastname") == null ? "" : String.valueOf(student.get("lastname"));
        return (first + " " + last).trim();
    }

    private static double roundOne(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private static double roundTwo(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private static void fail(HttpExchange ex, Exception e) throws IOException {
        if (e instanceof IllegalArgumentException) {
            Reply.error(ex, 400, e.getMessage());
        } else if (Database.isDuplicate(e)) {
            Reply.error(ex, 409, "Duplicate record");
        } else if (Database.isForeignKeyError(e)) {
            Reply.error(ex, 400, "Related record not found");
        } else {
            Reply.error(ex, 500, "Server error");
        }
    }
}
