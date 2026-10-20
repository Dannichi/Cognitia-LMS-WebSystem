-- Cognitia LMS - MariaDB schema
CREATE DATABASE IF NOT EXISTS cognitia CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cognitia;

-- ===== Academic structure =====

CREATE TABLE programs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(20)  NOT NULL UNIQUE,          -- e.g. BSCS
  name          VARCHAR(150) NOT NULL,
  description   TEXT,
  status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  color         VARCHAR(20),
  catalog_id    VARCHAR(50),                           -- id from academic-config.js
  department_id VARCHAR(50),
  campus_id     VARCHAR(50)
) ENGINE=InnoDB;

CREATE TABLE sections (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  program_id INT        NOT NULL,
  year       TINYINT    NOT NULL,                      -- year level 1-4
  letter     CHAR(1)    NOT NULL,                      -- A, B, C...
  capacity   INT        NOT NULL DEFAULT 40,
  UNIQUE (program_id, year, letter),
  FOREIGN KEY (program_id) REFERENCES programs(id)
) ENGINE=InnoDB;

CREATE TABLE courses (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  code      VARCHAR(20)  NOT NULL UNIQUE,
  name      VARCHAR(150) NOT NULL,
  semester  TINYINT,
  units     TINYINT,
  status    ENUM('active','inactive') NOT NULL DEFAULT 'active'
) ENGINE=InnoDB;

CREATE TABLE course_programs (
  course_id  INT     NOT NULL,
  program_id INT     NOT NULL,
  year       TINYINT,                                  -- year level in that program
  PRIMARY KEY (course_id, program_id),
  FOREIGN KEY (course_id)  REFERENCES courses(id)  ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE section_courses (
  section_id INT NOT NULL,
  course_id  INT NOT NULL,
  PRIMARY KEY (section_id, course_id),
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id)  REFERENCES courses(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Users =====

CREATE TABLE users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  student_no      INT UNIQUE,                          -- students only, from 2026001
  first_name      VARCHAR(60)  NOT NULL,
  middle_name     VARCHAR(60),
  last_name       VARCHAR(60)  NOT NULL,
  email           VARCHAR(120) NOT NULL UNIQUE,
  phone           VARCHAR(20),
  password_hash   VARCHAR(255) NOT NULL,               -- "salt:hash", never plain text
  role            ENUM('admin','professor','student') NOT NULL,
  program_id      INT,
  section_id      INT,                                 -- students only
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  approval_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  registered_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at     DATETIME,
  reviewed_by     INT,
  FOREIGN KEY (program_id)  REFERENCES programs(id) ON DELETE SET NULL,
  FOREIGN KEY (section_id)  REFERENCES sections(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB;

-- which professor teaches which course in which section
CREATE TABLE teaching_assignments (
  section_id   INT NOT NULL,
  course_id    INT NOT NULL,
  professor_id INT NOT NULL,
  PRIMARY KEY (section_id, course_id, professor_id),
  FOREIGN KEY (section_id, course_id) REFERENCES section_courses(section_id, course_id) ON DELETE CASCADE,
  FOREIGN KEY (professor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Announcements =====

CREATE TABLE announcements (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  author_id    INT,
  title        VARCHAR(200) NOT NULL,
  body         TEXT NOT NULL,
  type         VARCHAR(30),
  category     VARCHAR(30),
  audience     ENUM('all','students','professors') NOT NULL DEFAULT 'all',
  featured     BOOLEAN NOT NULL DEFAULT FALSE,
  status       ENUM('draft','scheduled','published') NOT NULL DEFAULT 'draft',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME,
  scheduled_at DATETIME,
  event_date   DATE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE announcement_reads (
  user_id         INT NOT NULL,
  announcement_id INT NOT NULL,
  read_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, announcement_id),
  FOREIGN KEY (user_id)         REFERENCES users(id)         ON DELETE CASCADE,
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Lessons =====

CREATE TABLE lessons (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  course_id    INT NOT NULL,
  professor_id INT NOT NULL,
  title        VARCHAR(200) NOT NULL,
  description  TEXT,
  file_name    VARCHAR(255),
  file_data    LONGBLOB,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id)    REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (professor_id) REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE lesson_sections (
  lesson_id  INT NOT NULL,
  section_id INT NOT NULL,
  PRIMARY KEY (lesson_id, section_id),
  FOREIGN KEY (lesson_id)  REFERENCES lessons(id)  ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE lesson_progress (                         -- student marked lesson as done
  student_id INT NOT NULL,
  lesson_id  INT NOT NULL,
  done_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, lesson_id),
  FOREIGN KEY (student_id) REFERENCES users(id)   ON DELETE CASCADE,
  FOREIGN KEY (lesson_id)  REFERENCES lessons(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Assignments =====

CREATE TABLE assignments (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  course_id       INT NOT NULL,
  professor_id    INT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  due_date        DATETIME,
  points          INT NOT NULL DEFAULT 100,
  attachment_name VARCHAR(255),
  attachment_type VARCHAR(100),
  attachment_data LONGBLOB,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id)    REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (professor_id) REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE assignment_sections (
  assignment_id INT NOT NULL,
  section_id    INT NOT NULL,
  PRIMARY KEY (assignment_id, section_id),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id)    REFERENCES sections(id)    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE submissions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT NOT NULL,
  student_id    INT NOT NULL,
  note          TEXT,
  file_name     VARCHAR(255),
  file_data     LONGBLOB,
  status        ENUM('submitted','graded') NOT NULL DEFAULT 'submitted',
  submitted_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  grade         DECIMAL(5,2),
  feedback      TEXT,
  graded_at     DATETIME,
  UNIQUE (assignment_id, student_id),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id)    REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Quizzes =====

CREATE TABLE quizzes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  course_id    INT NOT NULL,
  professor_id INT NOT NULL,
  title        VARCHAR(200) NOT NULL,
  due_date     DATETIME,
  time_limit   INT,                                    -- minutes
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id)    REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (professor_id) REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE quiz_sections (
  quiz_id    INT NOT NULL,
  section_id INT NOT NULL,
  PRIMARY KEY (quiz_id, section_id),
  FOREIGN KEY (quiz_id)    REFERENCES quizzes(id)  ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE quiz_questions (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  quiz_id        INT NOT NULL,
  type           ENUM('mcq','identification','essay') NOT NULL,
  text           TEXT NOT NULL,
  points         INT NOT NULL DEFAULT 1,
  option_a       VARCHAR(255),                         -- mcq only
  option_b       VARCHAR(255),
  option_c       VARCHAR(255),
  option_d       VARCHAR(255),
  correct_option CHAR(1),                              -- mcq: A-D
  answer         VARCHAR(255),                         -- identification only
  rubric         TEXT,                                 -- essay only
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE quiz_attempts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  quiz_id      INT NOT NULL,
  student_id   INT NOT NULL,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (quiz_id, student_id),                        -- retake replaces the old attempt
  FOREIGN KEY (quiz_id)    REFERENCES quizzes(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE quiz_answers (
  attempt_id     INT NOT NULL,
  question_id    INT NOT NULL,
  answer         TEXT,
  points_awarded DECIMAL(5,2),                         -- NULL = essay not yet graded
  feedback       TEXT,
  PRIMARY KEY (attempt_id, question_id),
  FOREIGN KEY (attempt_id)  REFERENCES quiz_attempts(id)  ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Activity log =====

CREATE TABLE activity_log (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  actor_id     INT,
  entity_type  ENUM('user','program','section','course','announcement') NOT NULL,
  entity_id    INT,
  entity_label VARCHAR(200),
  action       VARCHAR(30) NOT NULL,                   -- created / updated / deleted ...
  description  VARCHAR(255),
  details      TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
