-- Preserve all positivity, discount and amount checks; remove only whole-kg restrictions.
ALTER TABLE "PurchaseLine" DROP CONSTRAINT "PurchaseLine_quantityKg_whole";
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_signedQuantityKg_whole";
DO $$
DECLARE r record; definition text; field text;
BEGIN
 FOR r IN SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE contype='c' AND conrelid IN ('"PurchaseLine"'::regclass, '"PurchaseRevision"'::regclass)
  AND pg_get_constraintdef(oid) LIKE '%trunc(%'
 LOOP
  definition := r.def;
  FOREACH field IN ARRAY ARRAY['quantityKg','returnedKg','discountKg'] LOOP
   definition := replace(definition, format('"%s" = trunc("%s")', field, field), 'true');
  END LOOP;
  IF definition LIKE '%trunc(%' THEN RAISE EXCEPTION 'Unexpected whole-weight check: %', r.conname; END IF;
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.conname, definition);
 END LOOP;
END $$;
