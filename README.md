# How to Set-Up the local storage database

> This branch implements a backend and database using SQL integration.

![Status](https://img.shields.io/badge/status-in%20development-orange)
![Type](https://img.shields.io/badge/type-LMS%20web%20app-blue)

## Requirements
- [ ] Node.js
- [ ] Xampp

## Steps to follow 

- Open Xammp, then press start for both SQL and Apache. After that click the admin along the row of SQL. It will open an localhost database and insert this query:
```SQL
# You can copy and paste the contents of your file here
-- ═══════════════════════════════════════════════════════════
--  Cognitia — database-first tables (programs, sections, courses, users)
--  The website loads these tables through server.js, so rows you add or
--  delete here appear on the website after a page refresh.
--
--  Run in phpMyAdmin → lms_data → Import (or SQL tab).
--  WARNING: this DROPS and recreates the tables below. On first run,
--  server.js rebuilds them from the saved app_state JSON. After the
--  database holds your real data, do NOT re-import this file.
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS lms_data
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lms_data;

SET FOREIGN_KEY_CHECKS = 0;

-- Leftovers from older schema files (children before parents)
DROP TABLE IF EXISTS quiz_results;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS quiz_questions;
DROP TABLE IF EXISTS quizzes;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS lessons;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS counters;

DROP TABLE IF EXISTS professor_sections;
DROP TABLE IF EXISTS user_courses;
DROP TABLE IF EXISTS program_courses;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS programs;

SET FOREIGN_KEY_CHECKS = 1;

-- id is AUTO_INCREMENT: you may INSERT without an id and MySQL numbers it.
-- (The website also sends its own ids, which MySQL accepts.)

CREATE TABLE programs (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(30)  NOT NULL,
  name        VARCHAR(150) NOT NULL,
  description TEXT NULL,
  color       VARCHAR(20)  NULL,
  status      VARCHAR(20)  NULL
) ENGINE=InnoDB;

CREATE TABLE sections (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  year       VARCHAR(20)  NULL,
  letter     VARCHAR(10)  NULL,
  capacity   INT NULL,
  CONSTRAINT fk_sec_program FOREIGN KEY (program_id)
    REFERENCES programs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE courses (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code     VARCHAR(30)  NOT NULL,
  name     VARCHAR(150) NOT NULL,
  year     VARCHAR(20)  NULL,
  semester VARCHAR(20)  NULL,
  units    TINYINT UNSIGNED NULL,
  status   VARCHAR(20)  NULL
) ENGINE=InnoDB;

CREATE TABLE program_courses (
  program_id INT UNSIGNED NOT NULL,
  course_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (program_id, course_id),
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id)  REFERENCES courses(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id    VARCHAR(10)  NULL UNIQUE,            -- students only
  firstname     VARCHAR(60)  NOT NULL,
  middlename    VARCHAR(60)  NOT NULL DEFAULT '',
  lastname      VARCHAR(60)  NOT NULL DEFAULT '',
  display_name  VARCHAR(150) NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,               -- bcrypt, never plaintext
  role          ENUM('student','professor','admin') NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'active',
  program_id    INT UNSIGNED NULL,
  section_id    INT UNSIGNED NULL,
  joined        VARCHAR(40)  NULL,                   -- text like "Oct 10, 2026"
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_program FOREIGN KEY (program_id)
    REFERENCES programs(id) ON DELETE SET NULL,
  CONSTRAINT fk_user_section FOREIGN KEY (section_id)
    REFERENCES sections(id) ON DELETE SET NULL,
  INDEX idx_role (role)
) ENGINE=InnoDB;

CREATE TABLE user_courses (
  user_id   INT UNSIGNED NOT NULL,
  course_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, course_id),
  FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE professor_sections (
  user_id    INT UNSIGNED NOT NULL,
  section_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, section_id),
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Holds everything not in the tables above (lessons, assignments, quizzes,
-- announcements, grades, student submissions) until those get tables too.
CREATE TABLE IF NOT EXISTS app_state (
  state_key  VARCHAR(64) NOT NULL PRIMARY KEY,
  state_json LONGTEXT    NOT NULL,
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
```
- Then bash this in terminal
  
```bash
npm init -y
```
