DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mrba_app') THEN
  REVOKE ALL ON TABLE "_prisma_migrations" FROM mrba_app;
 END IF;
END $$;
