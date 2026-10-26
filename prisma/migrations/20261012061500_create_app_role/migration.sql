-- Create application role for non-superuser RLS enforcement
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'billing_app') THEN
    CREATE ROLE billing_app LOGIN PASSWORD 'billing_app_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE billing_db TO billing_app;
GRANT ALL ON SCHEMA public TO billing_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO billing_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO billing_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO billing_app;
