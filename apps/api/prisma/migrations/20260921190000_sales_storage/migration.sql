INSERT INTO "Warehouse" (id, "siteId", name)
SELECT gen_random_uuid(), id, 'Склад для продажи' FROM "Site"
ON CONFLICT ("siteId", name) DO NOTHING;
INSERT INTO "StockLocation" (id, "warehouseId", name, kind)
SELECT gen_random_uuid(), id, 'Склад для продажи', 'STORAGE' FROM "Warehouse" WHERE name='Склад для продажи'
ON CONFLICT ("warehouseId", name) DO NOTHING;
