ALTER TABLE "StockLot" ADD COLUMN "stockKind" TEXT;
ALTER TABLE "StockLot" ADD CONSTRAINT "stock_lot_kind_check" CHECK ("stockKind" IS NULL OR "stockKind" = 'MATERIAL');
