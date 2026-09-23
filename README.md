# MRBA — учёт завода

React Native / Expo iPhone-приложение, NestJS API, Prisma / PostgreSQL. Онлайн-режим. Завод: Каттакурган, время Asia/Tashkent, смены 08:00–20:00 / 20:00–08:00. Роль OWNER, вес kg/t, валюты UZS/USD.

Реализованы склад, производство, обязательные отходы, повторное использование, продажи/отгрузки, договоры, отчёты, черновики и аудит. Килограммы — целые; дата ночной смены — день начала. Проверенный объём и границы: [STATUS](docs/STATUS.md). Архитектура: [ARCHITECTURE](docs/ARCHITECTURE.ru.md). Развёртывание на вашем VPS: [DEPLOYMENT](docs/DEPLOYMENT.ru.md).

В ветке `feature/ai-client-search` развивается модуль поиска потенциальных покупателей с проверяемыми источниками, рейтингом и ручным подтверждением владельца: [описание модуля](docs/AI_CLIENT_SEARCH.ru.md).

Операционные заметки о рабочем сервере и App Store хранятся локально и не публикуются в репозитории.

## Локальный запуск

Требования: Node.js 24, npm, Docker; для iOS — Xcode 26.4+, iOS Simulator и CocoaPods. Зависимости закреплены package-lock.json.

```sh
node scripts/setup.mjs
npm ci
npm run db:generate
docker compose up -d --wait postgres
npm run db:migrate
npm run build
npm run db:seed
npm run dev:api
```

`setup` создаёт случайные локальные секреты и пароль OWNER в `.env`, существующий файл не меняет. `seed` не изменяет пароль уже существующего владельца и не создаёт вымышленных закупок/остатков. Логин и пароль для приложения — `OWNER_LOGIN` / `OWNER_PASSWORD` в локальном `.env`; файл не коммитится.

API: `http://127.0.0.1:3107/api/v1`, проверка `GET /health/ready`. Изолированный PostgreSQL development: только `127.0.0.1:55439`, volume `mrba-dev_postgres_data`. Другие базы/сервисы машины не используются.

Во втором терминале:

```sh
npm run dev:mobile
```

Первую native-сборку выполнить в третьем терминале:

```sh
cd apps/mobile
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npx expo run:ios --device --port 8087
```

Выбрать доступный iPhone. Если developer client открывает неправильный порт, указать `http://localhost:8087` в его списке серверов. Скрипт Metro принудительно выбирает IPv4 для localhost, чтобы native-клиент подключался к тому же адресу.

API URL задаётся `EXPO_PUBLIC_API_URL` при сборке приложения; в debug есть fallback на локальный API. В release fallback отсутствует. Пароли/JWT secrets никогда не передаются через EXPO_PUBLIC-переменные. HTTP localhost разрешён только для разработки; VPS-релиз потребует HTTPS и отдельной конфигурации.

## Проверки

```sh
npm run typecheck
npm test
# Один раз создать отдельную тестовую БД:
docker compose exec -T postgres psql -U mrba -d postgres -c 'CREATE DATABASE mrba_test;'
npm run test:integration
node scripts/verify-backup.mjs
# После сборки образов mrba-api:local и mrba-migrate:local:
node scripts/verify-production.mjs
npm audit
```

Интеграционные тесты сами применяют миграции к `mrba_test`, запускают seed и проверяют реальный PostgreSQL через HTTP Nest. Они отказываются работать с базой другого имени. Тестовые записи остаются только в отдельной тестовой БД, повторный запуск поддерживается.

Проверяются повторы/rollback, конкурентный склад, резервы, kg/t, обязательные отходы и баланс плавки, reuse/восстановление отходов, отгрузка и лимит договора, сторно, неизменяемость истории, отчёты и трассировка, версии/пагинация, черновики, OWNER и refresh-token reuse. CI воспроизводит domain/integration проверки.

## API

- Авторизация: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`.
- Справочники: `/materials`, `/suppliers`, `/items`, `/equipment`, `/locations`, `/customers`; изменения `/catalog/:kind/:id/edit`.
- Склад: `/purchase-receipts`, `/stock`, `/inventory/lots`, `/inventory/transfer`, `/inventory/return-supplier`, `/inventory/adjust`, `/inventory/reserve`, `/reservations/:id/release`.
- Производство: `/batches`, `/batches/:id/complete`, `/batches/:id/cancel`, `/shifts`, `/shifts/:id/close`, `/shifts/:id/reopen`.
- Отходы: `/waste/recover`, `/waste/dispose`; повторная выдача через transfer, продажа через shipments с kind WASTE.
- Продажи: `/contracts`, `/contracts/:id/amend`, `/contracts/:id/close`, `/shipments`, `/shipments/:id/depart`.
- Контроль: `/reports`, `/trace/:lotId`, `/documents`, `/documents/:id/reverse`, `/audit`, `/users`, `/sessions`.
- Черновики: `/drafts`, `/drafts/:id`, `/drafts/:id/edit`, `/drafts/:id/prepare`, `/drafts/:id/cancel`. Результат команды: `/commands/:id`.
- Система: `/system/context`, `/dashboard`, `/health/live`, `/health/ready`.

Базовый путь `/api/v1`. Списки возвращают `{items,nextCursor}`; параметры `cursor`, `limit` (1–100), `search` для поддерживающих поиск справочников. `/stock` использует составной cursor партии/зоны. `/reports` принимает `from`, `to` (конец не включён), `equipmentId`, `shiftId`, `customerId`, `supplierId`; даты без времени трактуются в Asia/Tashkent, производство — по дате начала смены. `/drafts` и `/sessions` возвращают массив текущих активных записей.

Проведение: `Authorization: Bearer …`, `Idempotency-Key: UUID`, `X-Recovery-Epoch: …`. Пример тела прихода:

```json
{
  "supplierId": "UUID поставщика",
  "currency": "UZS",
  "lines": [
    {
      "materialId": "UUID материала",
      "quantity": "1.250",
      "unit": "t",
      "unitPricePerKg": "125000"
    }
  ]
}
```

Положительное количество, минимум одна строка, максимум 50. Цена за kg, не за t. Пока нет утверждённой политики округления, сохраняется точное произведение; этот итог не считается бухгалтерским документом. Для повторной отправки сохранять тот же ключ и тело. Новый ключ означает новую операцию.
