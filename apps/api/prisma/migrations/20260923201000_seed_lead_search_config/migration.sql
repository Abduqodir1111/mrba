INSERT INTO "LeadAgentConfig" (
  "id", "productNames", "countries", "minimumOrderKg", "buyerTypes",
  "outreachLanguages", "intermediaryMode", "updatedAt"
)
VALUES (
  'default',
  ARRAY['Латунные прутки', 'Медные прутки'],
  ARRAY['Узбекистан', 'Казахстан', 'Таджикистан', 'Кыргызстан'],
  1000,
  ARRAY['Промышленные заводы', 'Производственные цеха', 'Предприятия, использующие латунные или медные прутки в производстве'],
  ARRAY['Определять по языку сайта компании'],
  'MANUFACTURERS_ONLY',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "productNames" = EXCLUDED."productNames",
  "countries" = EXCLUDED."countries",
  "minimumOrderKg" = EXCLUDED."minimumOrderKg",
  "buyerTypes" = EXCLUDED."buyerTypes",
  "outreachLanguages" = EXCLUDED."outreachLanguages",
  "intermediaryMode" = EXCLUDED."intermediaryMode",
  "updatedAt" = CURRENT_TIMESTAMP;
