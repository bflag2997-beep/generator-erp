-- Run this script inside PostgreSQL as a superuser or database admin.
-- غيّر كلمة المرور قبل الاستخدام الحقيقي.

CREATE DATABASE generator_erp;

-- Optional dedicated user:
-- CREATE USER generator_admin WITH PASSWORD 'CHANGE_THIS_STRONG_PASSWORD';
-- GRANT ALL PRIVILEGES ON DATABASE generator_erp TO generator_admin;

-- After creating the database, start the app with:
-- set DATABASE_URL=postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/generator_erp
-- npm start
