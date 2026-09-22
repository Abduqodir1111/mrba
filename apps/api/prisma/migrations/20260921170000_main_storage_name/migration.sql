UPDATE "StockLocation" s SET name='Основной склад'
WHERE s.name='Основная зона' AND s.kind='STORAGE'
AND NOT EXISTS (SELECT 1 FROM "StockLocation" other WHERE other."warehouseId"=s."warehouseId" AND other.name='Основной склад');
