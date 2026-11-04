BEGIN;
-- PostgreSQL 18 requires its bootstrap role to remain a superuser.
ALTER ROLE mrba_owner RENAME TO mrba_admin;
DO $$ DECLARE password_hash text; BEGIN
 SELECT rolpassword INTO password_hash FROM pg_authid WHERE rolname='mrba_admin';
 EXECUTE format('CREATE ROLE mrba_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',password_hash);
END $$;
ALTER ROLE mrba_admin PASSWORD NULL;
CREATE ROLE mrba_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD NULL;
GRANT pg_read_all_data TO mrba_backup;
DO $$ DECLARE r record; BEGIN
 EXECUTE format('ALTER DATABASE %I OWNER TO mrba_owner',current_database());
 FOR r IN SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m') LOOP
  EXECUTE format('ALTER %s public.%I OWNER TO mrba_owner', CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,r.relname);
 END LOOP;
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP
  EXECUTE format('ALTER ROUTINE %s OWNER TO mrba_owner',r.signature);
 END LOOP;
 FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' LOOP
  EXECUTE format('ALTER TYPE public.%I OWNER TO mrba_owner',r.typname);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO mrba_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO mrba_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO mrba_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mrba_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO mrba_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mrba_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO mrba_app;
COMMIT;
