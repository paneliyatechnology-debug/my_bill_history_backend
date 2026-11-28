-- Create application role for non-superuser RLS enforcement
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'billing_app') THEN
    CREATE ROLE billing_app LOGIN PASSWORD 'billing_app_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT ALL PRIVILEGES ON DATABASE %I TO billing_app', current_database());
END
$$;
GRANT ALL ON SCHEMA public TO billing_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO billing_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO billing_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO billing_app;
