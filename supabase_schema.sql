-- ==========================================
-- SUPABASE SCHEMA - ATTENDANCE MANAGEMENT
-- Production-ready morning/evening + face review flow
-- ==========================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN CREATE TYPE user_role AS ENUM ('ADMIN', 'ADVISOR', 'HOD', 'PRINCIPAL', 'STUDENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE attendance_status AS ENUM ('Present', 'Absent', 'Late'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE attendance_period AS ENUM ('Morning', 'Evening'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE attendance_source AS ENUM ('face_auto', 'review_approved', 'manual', 'auto_absent'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('SMS', 'Voice', 'Email'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE notification_status AS ENUM ('Pending', 'Sent', 'Failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE face_asset_kind AS ENUM ('reference', 'review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE recognition_review_status AS ENUM ('Pending', 'Approved', 'Rejected', 'Expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id UUID REFERENCES auth.users(id),
    name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'STUDENT',
    email VARCHAR(255) UNIQUE,
    username VARCHAR(100) UNIQUE,
    dept_id UUID REFERENCES departments(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id UUID REFERENCES auth.users(id),
    register_number VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    dob DATE,
    blood_group VARCHAR(10),
    address TEXT,
    department_id UUID REFERENCES departments(id) NOT NULL,
    year INT NOT NULL,
    semester INT NOT NULL,
    parent_phone VARCHAR(20) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID REFERENCES departments(id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    subject VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS attendance_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    morning_start TIME NOT NULL DEFAULT '08:30:00',
    morning_end TIME NOT NULL DEFAULT '10:00:00',
    evening_start TIME NOT NULL DEFAULT '15:30:00',
    evening_end TIME NOT NULL DEFAULT '17:00:00',
    auto_mark_absent BOOLEAN NOT NULL DEFAULT TRUE,
    auto_accept_threshold NUMERIC(4,2) NOT NULL DEFAULT 0.72,
    review_threshold NUMERIC(4,2) NOT NULL DEFAULT 0.58,
    consensus_frames INT NOT NULL DEFAULT 3,
    cooldown_seconds INT NOT NULL DEFAULT 20,
    review_expiry_minutes INT NOT NULL DEFAULT 90,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO attendance_settings (
    id, morning_start, morning_end, evening_start, evening_end,
    auto_mark_absent, auto_accept_threshold, review_threshold,
    consensus_frames, cooldown_seconds, review_expiry_minutes
) VALUES (
    1, '08:30:00', '10:00:00', '15:30:00', '17:00:00',
    TRUE, 0.72, 0.58, 3, 20, 90
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS academic_calendar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    reason TEXT,
    is_holiday BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recognition_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_name TEXT,
    image_path TEXT,
    terminal_id VARCHAR(120),
    period attendance_period NOT NULL,
    candidate_student_id UUID REFERENCES students(id),
    resolved_student_id UUID REFERENCES students(id),
    confidence NUMERIC(6,5),
    status recognition_review_status NOT NULL DEFAULT 'Pending',
    reviewed_by TEXT,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_face_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) NOT NULL,
    embedding vector(512) NOT NULL,
    capture_slot INT,
    quality_score NUMERIC(6,5),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_face_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) NOT NULL,
    bucket_name TEXT NOT NULL,
    image_path TEXT NOT NULL,
    image_kind face_asset_kind NOT NULL,
    quality_score NUMERIC(6,5),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) NOT NULL,
    session_id UUID REFERENCES sessions(id),
    status attendance_status NOT NULL DEFAULT 'Present',
    period attendance_period,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    marked_by UUID REFERENCES users(id),
    source attendance_source,
    confidence NUMERIC(6,5),
    review_id UUID REFERENCES recognition_reviews(id),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) NOT NULL,
    type notification_type NOT NULL,
    status notification_status NOT NULL DEFAULT 'Pending',
    message TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_students_department_year_semester ON students(department_id, year, semester);
CREATE INDEX IF NOT EXISTS idx_students_is_active ON students(is_active);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_student_active ON student_face_embeddings(student_id, is_active);
CREATE INDEX IF NOT EXISTS idx_face_assets_student_kind_active ON student_face_assets(student_id, image_kind, is_active);
CREATE INDEX IF NOT EXISTS idx_reviews_status_period_created ON recognition_reviews(status, period, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_student_period_time ON attendance(student_id, period, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_status_time ON attendance(status, timestamp DESC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('student-reference-faces', 'student-reference-faces', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('recognition-review-faces', 'recognition-review-faces', true)
ON CONFLICT (id) DO NOTHING;

