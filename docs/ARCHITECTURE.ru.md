# Производственная информационная система — архитектура для согласования

Дата: 21 сентября 2026. Версия: 0.5 (добавлены требования к интерфейсу и iPhone Simulator). Статус: **УТВЕРЖДЕНА ПОЛЬЗОВАТЕЛЕМ; РЕАЛИЗАЦИЯ НАЧАТА ПОЭТАПНО**.

Документ закрывает 30 пунктов первого этапа задания с учётом корректировки пользователя: **приложение работает только онлайн**. Разделы об автономной работе и синхронизации заменены моделью прямого API и обработки сетевых сбоев. SQLite, локальная бизнес-БД, очередь отложенных операций и Sync Engine исключены. Пользователь явно подтвердил архитектуру и разрешил начать разработку. Текущий объём реализации и оставшиеся этапы описаны в STATUS.md. На момент первоначального анализа рабочая директория была пуста.

Обозначения: **решение** — техническое предложение для согласования; **OPEN QUESTION** — правило, которое должен определить завод. Предлагаемые значения точности, сроков и ограничений не являются утверждёнными бизнес-нормативами.

Подтверждённые пользователем параметры:

- Работа приложения — только онлайн.
- Интерфейс должен быть красивым и современным; мобильные экраны и сценарии необходимо запускать и проверять в iPhone Simulator.
- Местоположение завода — Каттакурган, Самаркандская область, Узбекистан; подтверждённый часовой пояс — `Asia/Tashkent`. Смены и отображение времени рассчитываются в этом часовом поясе.
- Две смены по 12 часов: дневная 08:00–20:00, ночная 20:00–08:00 следующего дня.
- Ввод и отображение веса — в тоннах и килограммах; каноническое хранение в kg, точное преобразование `1 t = 1000 kg`.
- Поддерживаемые валюты — узбекский сум (UZS) и доллар США (USD).
- В первой версии одна роль `OWNER` («Владелец») с доступом ко всем функциям приложения. Количество учётных записей этим не определяется.

Дополнительно подтверждены целые килограммы и дата ночной смены по дню её начала. Указание валют не задаёт обменный курс или правила округления. Часовой пояс `Asia/Tashkent` подтверждён пользователем. Эти оставшиеся вопросы перечислены в разделе 30.

Основные инварианты:

- Проведённая операция, её движения, аудит и результат идемпотентности фиксируются одной транзакцией.
- Источник истины об остатках — неизменяемый журнал движений. Таблица остатков — его проверяемая транзакционная проекция.
- Любое складское количество относится к конкретным номенклатуре, партии и месту хранения.
- Создание, изменение и проведение бизнес-операций требуют доступного API. Операция считается выполненной только после подтверждения серверного commit.
- Повтор команды не создаёт повторное движение. Исправление проведённой операции создаёт новую связанную операцию.
- Финансовые суммы и масса вычисляются десятичной арифметикой; закупочные цены сохраняются по партиям.
- Отходы, пригодные для повторного использования, остаются учитываемым запасом, а не исчезают как потери.

## 1. System Architecture

**Решение: модульный монолит NestJS + PostgreSQL и отдельное приложение React Native.** Один завод — одна установка. В модели есть площадка `Site`, но это не SaaS и не заявленная многопользовательская изоляция разных организаций.

Поток работы:

```text
iPhone: экран → application service → REST API client
                                      ↓ HTTPS
VPS: Nginx → NestJS: auth → permission → command handler
                                      ↓ одна транзакция
                               PostgreSQL
                               ├─ бизнес-документ
                               ├─ inventory ledger + balances
                               └─ audit + idempotency result
                                      ↓ после commit
iPhone: подтверждённый результат → обновление API-кэша → экран
```

Модули вызывают прикладные сервисы друг друга внутри процесса. Для критических действий используются единые транзакции PostgreSQL; распределённые транзакции, микросервисы и брокер сообщений сейчас не нужны. Аналитика первоначально работает на SQL-представлениях. Сводные проекции вводятся по измерениям производительности и всегда имеют отметку актуальности.

Границы первой версии: материальный и оперативный коммерческий учёт. Это не бухгалтерский, налоговый или платёжный регистр. Закуплено/отгружено на сумму не равно оплачено, выручка в бухгалтерском смысле не утверждена. Себестоимость и прибыль не рассчитываются до согласования методики.

## 2. Mobile Architecture

React Native + TypeScript, iOS first. Native-приложение обращается к NestJS через HTTPS REST API. Secure storage/Keychain используется для чувствительных токенов. Обязательной зависимости от облачной сборки нет; сборка и подпись возможны через Xcode. Совместимые версии зависимостей фиксируются на этапе foundation.

Слои:

1. `presentation`: экраны, формы, навигация, состояния загрузки и ошибки.
2. `application`: действия пользователя, валидация, работа с серверными черновиками.
3. `domain`: масса, деньги, баланс плавки, выполнение договора; чистые функции без React/API.
4. `data`: типизированный REST client, repositories и кэш ответов в оперативной памяти.
5. `platform`: Keychain, состояние сети и жизненный цикл iOS.

Экран использует application/query слой, а не самостоятельно собирает HTTP-запросы. Данные загружаются с API; после mutation соответствующие запросы обновляются. Критические остатки не изменяются оптимистически до серверного подтверждения. Сервер повторно проверяет все бизнес-правила независимо от мобильной валидации.

Черновики бизнес-документов сохраняются на сервере и требуют сети. Неотправленные поля формы существуют только в памяти текущего сеанса: после принудительного закрытия приложения их восстановление не гарантируется. При сетевой ошибке открытая форма не очищается; после восстановления связи пользователь явно повторяет сохранение.

Общими между backend/mobile могут быть схемы запросов, коды ошибок и чистые расчёты. Prisma-модели и серверные сервисы в приложение не переносятся. Password hashes и серверные refresh sessions никогда не возвращаются клиенту. API ограничивает поля по правам; например, закупочные цены не возвращаются пользователю без соответствующего permission.

Обновление данных: при открытии экрана, возврате приложения на передний план, ручном обновлении и после мутаций. Для dashboard/активной смены — ограниченный polling только видимого экрана; интервал определяется по нагрузке. WebSocket/SSE для первой версии не требуются. Кэш разделён по пользователю/площадке и очищается при выходе или смене области доступа.

## 3. Backend Architecture

| Модуль | Ответственность |
|---|---|
| Identity | Auth, пользователи, устройства, RBAC, refresh sessions |
| Catalog | Площадки, места хранения, материалы, продукты, отходы, оборудование |
| Partners | Поставщики, клиенты и контакты |
| Purchasing | Приходы, закупочные партии, возвраты поставщикам |
| Inventory | Ledger, остатки, резервы, перемещения, корректировки |
| Production | Смены, передача в цех, плавки, загрузки, выходы, баланс |
| Waste | Возврат, сортировка/восстановление, утилизация, повторное использование |
| Sales | Договоры, отгрузки продукции, продажи отходов |
| Reporting | Отчёты, dashboard, трассировка и аналитика |
| Request reliability | Общая инфраструктура idempotency и получения результата запроса; не отдельный бизнес-модуль |
| Audit | Неизменяемый бизнес-аудит |
| Operations | Health, structured logging, обслуживание и проверки целостности |

Inventory — единственный владелец записи складских проводок. Production/Sales/Purchasing передают ему типизированный запрос в текущей транзакции. Запись в ledger напрямую из контроллера запрещена архитектурно и ограничена правами БД.

Контроллеры отвечают за DTO/HTTP; use cases — за правила и транзакции; repositories — за запросы. Сетевые вызовы не выполняются внутри открытых критических транзакций. Событие для будущей внешней интеграции при необходимости пишется в transactional outbox, но отдельная интеграционная платформа сейчас не вводится.

## 4. Онлайн-режим и потеря связи

**Приложение работает только онлайн.** Для чтения актуальных данных, создания/сохранения черновиков и проведения операций нужен доступный сервер. Автономные операции и их последующая автоматическая отправка не поддерживаются.

| Ситуация | Поведение |
|---|---|
| Сервер доступен | Чтение и запись через API с проверкой текущих прав |
| Сеть пропала до отправки | Запрос не отправляется; действия сохранения/проведения блокируются; открытая форма остаётся в памяти |
| Уже открытый экран потерял связь | Ранее загруженные данные помечены «неактуально» с временем загрузки; работа с ними заблокирована |
| Новый экран без связи | Сообщение «Нет соединения с сервером» и повтор подключения; нет автономного каталога |
| Запрос отправлен, ответ потерян | Статус «Результат уточняется»; проверка commandId, без новой операции |
| Соединение восстановлено | Обновить данные и уточнить результат отправленного запроса; не отправлять неотправленные формы автоматически |
| Приложение перезапущено | Повторно загрузить серверные данные/черновики и уточнить результаты запросов по сохранённым идентификаторам |

Наличие Wi-Fi не считается доказательством доступности API. UI различает отсутствие сети, недоступность сервера, истёкшую сессию и предметный отказ. Нажатие «Отмена» или timeout на телефоне не означает rollback уже отправленной операции.

Резервы Inventory могут использоваться для планирования производства/отгрузок онлайн. Резервы, выданные устройству для автономного расхода, исключены.

Онлайн-приложение не заменяет организационную процедуру завода при длительном простое сети/VPS. Порядок остановки физических операций либо их регистрации на бумаге с последующим контролируемым вводом — OPEN QUESTION; функция автономного учёта в приложение не добавляется.

## 5. Надёжность онлайн-запросов и идемпотентность

Для критической mutation клиент создаёт `commandId UUID` и передаёт его как `Idempotency-Key`. Запрос содержит типизированный payload, `expectedVersion`, при необходимости `occurredAt`; actor определяется из сессии, а зарегистрированное устройство проверяется сервером. Один пользовательский замысел — один неизменяемый ID и payload во всех повторах.

Перед отправкой клиент сохраняет минимальный маркер неопределённого результата: commandId, тип действия, ID/версию серверного черновика, идентичность пользователя/площадки и recoveryEpoch. Это небольшая запись в защищённом хранилище, **не локальная бизнес-БД и не очередь операций**: в ней нет содержимого документа или команд для отложенного проведения. Если маркер сохранить не удалось, критический запрос не отправляется.

Обработка на сервере:

1. Проверить сессию, устройство, DTO, область доступа и recoveryEpoch.
2. Получить транзакционный mutex/advisory lock по commandId; проверить существующий receipt.
3. Сверить владельца и hash канонического payload. Тот же ID с другим телом → `IDEMPOTENCY_KEY_REUSED`.
4. Повтор принятого запроса возвращает прежний результат без выполнения; доступ к результату проверяется заново.
5. Для новой операции проверить текущие права, expectedVersion, состояние документа и остатки под нужными блокировками.
6. В одной транзакции записать документ, движения, balances, AuditLog и CommandReceipt.
7. Только после commit вернуть подтверждение с ID документа и его версией.

Идентичность критических запросов сохраняется вместе с бизнес-историей, без короткого TTL, который позволил бы повторить списание. Для проведения документа действует дополнительный unique constraint: одна исходная проводка на документ. Создание серверного черновика также идемпотентно, чтобы потерянный ответ не создавал второй документ.

Если HTTP-ответ потерян, клиент сначала вызывает `GET /commands/{commandId}`. Отсутствие receipt не доказывает, что операция не выполняется: она могла ещё не завершить транзакцию. Безопасен только повтор с тем же ID и **тем же** payload. Пока результат не определён, нельзя создавать новую команду на замену или менять исходный черновик.

После перезапуска маркер позволяет запросить результат и серверный документ. Если исходный payload недоступен или серверный черновик уже другой версии, автоматического повторного проведения нет: сначала разбор результата. Маркер не даёт прав другому пользователю; результат получает только автор или уполномоченный сотрудник.

GET допускает ограниченный retry с backoff/jitter. Mutation повторяется ограниченно только при гарантированно неизменных ID/payload; фонового накопления запросов нет. 401 вызывает один согласованный refresh; 409/422 требуют разбора пользователем. При восстановлении связи автоматически разрешено уточнять результат уже отправленного запроса, но не проводить новые документы.

`GET /system/context` возвращает recoveryEpoch — конфигурационный идентификатор поколения восстановления сервера. Он не меняется при обычном релизе, но меняется оператором после restore до открытия записи. Все mutations несут этот идентификатор; старые отклоняются, а неопределённые результаты сверяются вручную. Это предотвращает повтор ранее проведённого запроса, receipt которого мог быть утрачен при восстановлении из backup. Epoch не является протоколом синхронизации или общей ревизией данных.

## 6. Conflict Resolution Strategy

| Конфликт | Решение |
|---|---|
| Повтор commandId и того же payload | Вернуть предыдущий receipt |
| Тот же commandId, другой payload | Отклонить, не менять данные |
| Изменён справочник/черновик | `expectedVersion` + экран сравнения, без тихого LWW |
| Не хватает остатка | Отклонить проведение, показать партии/расхождение; не заменять партию автоматически |
| Договор закрыт/лимит исчерпан | Конфликт, решение ответственного |
| Плавка уже завершена другим устройством | Отклонить второе завершение, показать проведённый результат |
| Связанный документ ещё не проведён | Не выполнять зависимое действие до серверного подтверждения |
| У сотрудника отозваны права | Отказать в новом проведении; сохранить уже проведённую историю и очистить недоступный кэш |
| Сильно неверное время устройства | Серверное время приёма сохраняется отдельно; бизнес-дата проверяется по политике |
| Период/смена закрыты | Требовать разрешённого переоткрытия или корректирующей операции |

Для ledger нет merge и last-write-wins. Для введённой массы нет автоматического суммирования конкурирующих правок. LWW допустим только для некритичных пользовательских настроек интерфейса.

При двух одновременных списаниях последних 500 kg оба запроса блокируют один `InventoryBalance`; второй после ожидания видит результат первого и не может провести отрицательный остаток. При нескольких партиях блокировки берутся по стабильному порядку ключей. Транзакционные deadlock/serialization failures повторяются ограниченно, с тем же commandId. Блокировки строк PostgreSQL действуют до завершения транзакции: [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html).

## 7. Хранение данных на iPhone

**Локальная бизнес-БД не нужна.** SQLite, WatermelonDB, SQLCipher, локальные миграции, outbox/inbox и механизм репликации исключаются из проекта.

| Данные | Где хранятся |
|---|---|
| Склад, партии, производство, продажи, отчёты | PostgreSQL на сервере |
| Сохранённые черновики | PostgreSQL; создание и изменение только через API |
| Загруженные ответы API и открытая форма | Оперативная память приложения; не источник истины |
| Refresh token и минимальные маркеры запросов с неизвестным результатом | Keychain/secure storage |
| Access token | Предпочтительно оперативная память |
| Некритичные настройки отображения | Простое хранилище настроек без бизнес-данных |

Вес и деньги передаются API десятичными строками. Мобильные предварительные расчёты используют точную десятичную арифметику; сервер выполняет окончательные расчёты. Отказ от локальной БД не разрешает применять floating point для денежных сумм.

После выхода очищаются токены и кэш. Маркеры неопределённых результатов изолируются по прежней идентичности до повторного входа/разбора и не содержат документы; новый пользователь не может отправить запрос от имени предыдущего. Потеря или удаление приложения не удаляет серверные документы.

## 8. PostgreSQL architecture

Одна PostgreSQL БД. Типы и ограничения:

- PK: UUID, генерируемый сервером для сущностей и клиентом для commandId. Для link tables — составной unique/PK.
- Время: `timestamptz`, хранение UTC; бизнес-отображение через `Site.timezone` IANA. Для завода в Каттакургане подтверждён `Asia/Tashkent`; географическое местоположение хранится отдельно от идентификатора часового пояса.
- Масса: учёт в целых kg (подтверждено). Существующий физический `NUMERIC(20,3)` сохранён без переписывания истории; API и ограничения новых движений запрещают дробную часть kg. Тонны переводятся точно в целые kg.
- Цена за kg: предложение `NUMERIC(20,6)`; итог: `NUMERIC(24,6)` и валюта. Валютный scale, НДС, порядок округления — отдельная политика, не выводятся из примера.
- API передаёт decimal строками. Ввод и отображение поддерживают kg и t; выбранная единица явно подписана. В БД хранится одно количество в kg, без независимой копии в тоннах. Переключение единиц не меняет массу: `1 t = 1000 kg` (например, `1.5 t = 1500 kg`).
- Валюта денежных документов обязательна и ограничена UZS/USD; один документ имеет одну валюту для всех строк. Цена и сумма всегда отображаются с кодом валюты.
- Количества строк документов > 0; отрицательные значения только у подписанных проводок/явной разницы баланса.
- Справочники деактивируются. Проведённые документы и ledger физически не удаляются.
- `ON DELETE RESTRICT` для исторических FK. Cascade допустим для технических связей/непроведённых серверных черновиков после проверки.
- Unique: нормализованный login, номера документов в согласованной области, commandId, source document posting, source line lot, reversal linkage.
- CHECK: диапазоны, положительные количества, несовместимые статусы и nullable-поля. Межстрочные инварианты — транзакционный сервис и, где оправдано, deferred constraint triggers.

Индексы: все рабочие FK; ledger `(siteId, locationId, lotId, postedAt, id)`; документы `(siteId, status, occurredAt, id)`; production `(equipmentId, shiftInstanceId, status)`; contract/shipment по клиенту, договору, дате; command receipts по автору/времени; audit `(entityType, entityId, recordedAt)`.

Prisma используется для ORM и миграций; блокировки, CHECK, partial indexes и triggers при необходимости оформляются проверяемыми SQL-миграциями. Поддерживаемый способ транзакций зависит от закреплённой версии Prisma: он проверяется на PostgreSQL, а не предполагается по памяти. Транзакционная модель PostgreSQL обязательна независимо от API ORM: [Prisma — Transactions](https://www.prisma.io/docs/orm/fundamentals/transactions).

Для MVP: READ COMMITTED с явными блокировками известных агрегатов/остатков и проверенными constraints. Для операций с предикатными инвариантами, которые не покрываются общим locked aggregate, — SERIALIZABLE с retry. Нельзя считать обычную транзакцию достаточной защитой от гонок.

## 9. Полная ER model

Ниже логическая ER-модель предлагаемой версии. Раздел 12 дополняет её кардинальностями и составными ограничениями; разделы 10–11 являются словарём всех таблиц. Физический Prisma schema будет создан после утверждения.

```text
Site ─< Warehouse ─< StockLocation
Site ─< Equipment
Site ─< ShiftTemplate ─< ShiftInstance ─< ProductionBatch >─ Equipment

User >─< Role >─< Permission
User ─< UserSiteAccess >─ Site
User ─< Device ─< RefreshSession

Item ─1:0..1 Material
Item ─1:0..1 Product
Item ─1:0..1 WasteType
Item ─< StockLot ─< StockMovement >─ StockLocation
StockLot + StockLocation ─1:1 InventoryBalance
StockLot + StockLocation ─< StockReservation ─< ReservationConsumption

Supplier ─< PurchaseReceipt ─< PurchaseReceiptLine ─1:1 PurchaseLot ─1:1 StockLot
PurchaseLot ─< SupplierReturnLine >─ SupplierReturn >─ Supplier

ProductionBatch ─< ProductionIssue ─< ProductionIssueLine >─ StockLot
ProductionBatch ─< ProductionReturn ─< ProductionReturnLine >─ StockLot
ProductionBatch ─< ProductionBatchInput >─ StockLot
ProductionBatch ─1:0..1 ProductionCompletion
ProductionCompletion ─< ProductionOutput ─1:1 FinishedProductLot ─1:1 StockLot
ProductionCompletion ─< WasteRecord ─1:1 WasteLot ─1:1 StockLot
ProductionCompletion ─< ProductionDifference

WasteLot ─< WasteOperationInput >─ WasteOperation ─< WasteOperationOutput >─ StockLot
WasteLot ─< ProductionBatchInput              (непосредственное повторное использование)
WasteLot ─< WasteSaleLine >─ WasteSale >─ Customer
StockLot ─< LotTransformationInput >─ LotTransformation ─< LotTransformationOutput >─ StockLot

Customer ─< Contract ─< ContractLine >─ Product
Contract ─< Shipment >─ Vehicle
Shipment ─< ShipmentLine >─ ContractLine
ShipmentLine ─< ShipmentAllocation >─ FinishedProductLot

BusinessDocument ─1:0..1 типизированная шапка документа
BusinessDocument ─1:0..1 InventoryTransaction ─< StockMovement
InventoryTransaction ─< InventoryTransaction (reversesTransactionId)
InventoryAdjustment ─< InventoryAdjustmentLine >─ StockLot

CommandReceipt ─< AuditLog
CommandReceipt ─< BusinessDocument
ReportJob >─ User
```

`─<` означает 1:N; `>─<` — M:N через указанную ниже таблицу связей. `Item` — общая идентичность складской номенклатуры; ровно один subtype соответствует её kind. Нельзя одновременно трактовать одну запись как продукт и отход. `StockLot` всегда относится к одному Item; дополнительные таблицы партии содержат специфическое происхождение.

## 10. Полный список таблиц

Общие поля mutable-сущностей: `id`, `createdAt`, `updatedAt`, `version`; `siteId` там, где данные относятся к площадке. `deletedAt` только для допускающих soft delete сущностей. Immutable-строки используют `recordedAt`, автора через документ, без фиктивного редактируемого `updatedAt`.

### Identity и настройки

| Таблица | Ключевые поля и назначение |
|---|---|
| Site | name, timezone (Asia/Tashkent), country (Узбекистан), region (Самаркандская область), city (Каттакурган), address nullable, isActive |
| SitePolicyVersion | siteId, effectiveFrom, massScale, defaultCurrency, roundingPolicy, approvedBy; история утверждённых настроек |
| User | name, loginNormalized UNIQUE, phone, passwordHash, isActive, authVersion |
| Role | code UNIQUE, name, isActive; в первой версии единственная роль OWNER |
| Permission | code UNIQUE, description |
| UserRole | userId + roleId UNIQUE |
| RolePermission | roleId + permissionId UNIQUE |
| UserSiteAccess | userId + siteId UNIQUE |
| Device | userId, installationId UNIQUE, name, registeredAt, revokedAt, lastSeenAt |
| RefreshSession | userId, deviceId, tokenHash UNIQUE, familyId, parentSessionId, expiresAt, rotatedAt, revokedAt |

### Справочники и контрагенты

| Таблица | Ключевые поля и назначение |
|---|---|
| Supplier | name, legalName, registrationNumber, notes, isActive |
| SupplierContact | supplierId, name, phone, email, address |
| Customer | name, legalName, registrationNumber, notes, isActive |
| CustomerContact | customerId, name, phone, email, address |
| ItemCategory | code, name, parentId nullable |
| Item | code UNIQUE, name, kind MATERIAL/PRODUCT/WASTE, categoryId, canonicalUnit KG, isActive |
| Material | itemId PK/FK, specification, preferredDisplayUnit |
| Product | itemId PK/FK, specification, preferredDisplayUnit |
| WasteType | itemId PK/FK, description, isActive; способы обращения — разрешения, не один текущий disposition |
| Warehouse | siteId, code, name, kind, isActive |
| StockLocation | warehouseId, code, kind RAW/FINISHED/WASTE/WIP/QUARANTINE, productionBatchId nullable, isActive |
| Equipment | siteId, code, name, productionDirectionCode, isActive |
| ShiftTemplate | siteId, name, localStartTime, localEndTime, endDayOffset, effectiveFrom, effectiveTo, isActive; начальные записи: DAY 08:00–20:00 / offset 0, NIGHT 20:00–08:00 / offset 1 |
| ShiftInstance | templateId, businessDate, startsAt, endsAt, timezoneSnapshot, status OPEN/CLOSED, closedBy |
| Vehicle | normalizedNumber UNIQUE, displayNumber, notes, isActive |

### Документы, закупки, склад

| Таблица | Ключевые поля и назначение |
|---|---|
| BusinessDocument | siteId, kind, number, status, occurredAt, postedAt, createdBy, postedBy, deviceId, commandId, reason, reversesDocumentId |
| PurchaseReceipt | documentId PK/FK, supplierId, supplierDocumentNumber, currency |
| PurchaseReceiptLine | receiptId, lineNo, materialId, quantityKg, unitPricePerKg, originalUnit, originalQuantity, roundingPolicyVersion |
| StockLot | siteId, itemId, lotNumber, originKind, qualityStatus AVAILABLE/QUARANTINE/BLOCKED, createdAt |
| PurchaseLot | stockLotId PK/FK, receiptLineId UNIQUE; закупочные цена/поставщик/дата через неизменяемую строку прихода; сырьё OPENING без известного прихода имеет только StockLot |
| SupplierReturn | documentId PK/FK, supplierId, reason |
| SupplierReturnLine | returnId, purchaseLotId, quantityKg, locationId, agreedCreditAmount nullable, currency nullable |
| InventoryTransaction | documentId UNIQUE FK, movementType, reversesTransactionId UNIQUE nullable, postedAt |
| StockMovement | transactionId, lineNo, lotId, locationId, signedQuantityKg, reversalOfMovementId UNIQUE nullable |
| InventoryBalance | lotId + locationId UNIQUE, onHandKg, reservedKg, version |
| StockReservation | lotId, locationId, quantityKg, purpose, productionBatchId nullable, shipmentId nullable, status, expiresAt nullable |
| ReservationConsumption | reservationId, stockMovementId UNIQUE, quantityKg |
| InventoryTransfer | documentId PK/FK, fromLocationId, toLocationId, reason |
| InventoryTransferLine | transferId, lotId, quantityKg |
| InventoryAdjustment | documentId PK/FK, reason, approvedBy |
| InventoryAdjustmentLine | adjustmentId, lotId, locationId, expectedBalanceVersion, countedQuantityKg, beforeKg, deltaKg, afterKg |
| LotTransformation | documentId FK, productionCompletionId nullable, wasteOperationId nullable; ровно одна причина преобразования |
| LotTransformationInput | transformationId + lotId, consumedQuantityKg |
| LotTransformationOutput | transformationId + lotId, producedQuantityKg |

### Производство и отходы

| Таблица | Ключевые поля и назначение |
|---|---|
| ProductionBatch | siteId, batchNumber UNIQUE в площадке, equipmentId, shiftInstanceId, wipLocationId UNIQUE, status, startedAt, completedAt, createdBy, notes |
| ProductionIssue | documentId PK/FK, productionBatchId, shiftInstanceId |
| ProductionIssueLine | issueId, lotId, sourceLocationId, quantityKg |
| ProductionReturn | documentId PK/FK, productionBatchId, shiftInstanceId, reason |
| ProductionReturnLine | returnId, lotId, destinationLocationId, quantityKg |
| ProductionBatchInput | productionBatchId, lotId, quantityKg, shiftInstanceId, chargedAt, inputKind RAW/REUSED_WASTE/RECOVERED; фактическая загрузка, не повторная выдача |
| ProductionCompletion | documentId PK/FK, productionBatchId UNIQUE, completedAt, policyVersionId, approvedBy nullable |
| ProductionOutput | completionId, productId, quantityKg, destinationLocationId |
| FinishedProductLot | stockLotId PK/FK, productionOutputId UNIQUE nullable, openingAdjustmentLineId UNIQUE nullable; ровно один источник |
| WasteRecord | completionId, wasteTypeId, quantityKg, destinationLocationId, shiftInstanceId |
| WasteLot | stockLotId PK/FK, wasteRecordId UNIQUE nullable, recoveryOutputId UNIQUE nullable, openingAdjustmentLineId UNIQUE nullable; ровно один источник — плавка, остаток переработки или начальный ввод |
| ProductionDifference | completionId, signedQuantityKg, reasonCode, explanation, approvedBy nullable |
| WasteOperation | documentId PK/FK, kind RETURN/RECOVERY/DISPOSAL, reason, differenceKg, approvedBy nullable |
| WasteOperationInput | operationId, wasteLotId, sourceLocationId, quantityKg |
| WasteOperationOutput | operationId, lotId, destinationLocationId, quantityKg, outputKind RECOVERED/RESIDUAL/TRANSFERRED |

### Договоры и продажи

| Таблица | Ключевые поля и назначение |
|---|---|
| Contract | siteId, customerId, contractNumber, contractDate, status, currency, plannedTruckCount nullable, notes, version |
| ContractLine | contractId, lineNo, productId, agreedQuantityKg, unitPricePerKg, roundingPolicyVersion |
| ContractAmendment | contractId, number, effectiveAt, reason, approvedBy; история согласованных изменений |
| ContractAmendmentLine | amendmentId, contractLineId, previousQuantityKg, newQuantityKg, previousPrice, newPrice |
| Shipment | documentId PK/FK, contractId, vehicleId nullable, vehicleNumberSnapshot, departedAt nullable |
| ShipmentLine | shipmentId, contractLineId, quantityKg, unitPricePerKgSnapshot, amountSnapshot, pricingPolicyVersion |
| ShipmentAllocation | shipmentLineId, finishedProductLotId, locationId, quantityKg |
| WasteSale | documentId PK/FK, customerId, currency, vehicleId nullable, vehicleNumberSnapshot nullable |
| WasteSaleLine | wasteSaleId, wasteLotId, locationId, quantityKg, unitPricePerKg, amountSnapshot, pricingPolicyVersion |

### Audit, результаты запросов, отчёты

| Таблица | Ключевые поля и назначение |
|---|---|
| AuditLog | actorId nullable, action, entityType, entityId, previousData JSONB, newData JSONB, reason, commandId, deviceId, recordedAt |
| CommandReceipt | commandId PK, siteId, actorId, deviceId, commandType, payloadHash, status, result JSONB, rejectionCode, recordedAt |
| ReportJob | userId, siteId, reportType, filters JSONB, snapshotAt, definitionVersion, status, storageKey nullable, expiresAt, errorCode nullable |

ReportJob нужен только для тяжёлого экспорта; обычные отчёты не создают фоновые задания. Весь перечень выше — предлагаемая полная модель согласуемого объёма, а не обещание включить все таблицы в первую поставку.

Локальных бизнес-таблиц нет. JSONB используется для audit snapshots, результатов запросов и параметров отчёта; серверный склад и строки документов остаются реляционными.

## 11. Ключевые поля и правила целостности

`BusinessDocument` — общий FK-якорь, не универсальная JSON-таблица бизнеса. Шапка имеет ровно один subtype по kind. Соответствие обеспечивается составным FK с discriminator и deferred constraint trigger для наличия subtype к commit; одних TypeScript типов недостаточно.

Аналогично проверяются Item/subtype и StockLot/origin: PURCHASE → PurchaseLot, PRODUCTION_OUTPUT → FinishedProductLot, WASTE → WasteLot, RECOVERED → выход WasteOperation, OPENING → строка утверждённой начальной корректировки. Остаточный отход после recovery получает новый WasteLot со ссылкой на выход переработки, а не вымышленный WasteRecord плавки. Для неподтверждённого происхождения начальных остатков явно используется `OPENING`, без выдуманного поставщика. Ввод начальной готовой продукции/отходов требует соответствующего subtype партии с альтернативной FK на строку OPENING вместо productionOutput/wasteRecord; для всех вариантов действует ограничение «ровно один источник».

Проведённые строки документа неизменяемы. Смена supplier/customer master data не переписывает историю: юридически значимые реквизиты фиксируются при проведении отдельным snapshot документа, если это требуется заводом. Такой snapshot допустим в JSONB, но не заменяет FK и строки документа.

Коммерческая цена и округлённая сумма ShipmentLine фиксируются при проведении: это обоснованный исторический snapshot, а не постоянно редактируемая копия вычисляемого поля. Draft amount, shippedQuantity, remainingQuantity и progress рассчитываются. Возврат поставщику не предполагает автоматически возврат денег по закупочной цене; кредитная сумма требует отдельного основания.

`occurredAt` — заявленное время факта; `postedAt/recordedAt` — серверное время проведения; `businessDate` — производственная дата смены. Подмена одного другим запрещена. `version` — версия агрегата для optimistic concurrency. Глобальная ревизия для мобильной репликации не вводится.

## 12. Relationships

Все `...Id` в таблицах являются реальными FK, кроме диагностических polymorphic ссылок AuditLog. Область площадки проверяется составными FK `(siteId,id)` там, где возможна ошибочная межплощадочная ссылка.

Кардинальности и обязательные ограничения:

- Supplier 1:N PurchaseReceipt; Receipt 1:N Lines; каждая проведённая Line 1:1 PurchaseLot. ReturnLine N:1 PurchaseLot, supplier возврата совпадает с supplier прихода.
- Item 1:N StockLot; lot может находиться в N местах. Баланс уникален по `(lotId,locationId)`. Материал движения однозначно определяется lot.
- Warehouse 1:N StockLocation; Site 1:N Warehouse/Equipment/ShiftTemplate. WIP location 1:1 ProductionBatch.
- ProductionBatch N:1 Equipment и ShiftInstance; 1:N Issue/Input/Return, 1:0..1 Completion; Completion 1:N Outputs/WasteRecords/Differences. Отменённое завершение не удаляется; повторное оформление производится через явно связанную корректирующую процедуру, не вторым обычным completion.
- IssueLine перемещает конкретный lot в WIP; Input потребляет из WIP тот же lot. Input может использовать PurchaseLot, WasteLot либо восстановленный lot при совместимой номенклатуре.
- Output/WasteRecord 1:1 результирующий lot. Transformation имеет N input lots и M output lots; это связь преобразования N:M через узел события, без ложного точного распределения каждого исходного kg между выходами.
- WasteOperation 1:N inputs/outputs; RETURN сохраняет исходную номенклатуру и lot; RECOVERY создаёт новые lots; DISPOSAL не создаёт складской output.
- Customer 1:N Contract; Contract 1:N Lines/Shipments; Shipment 1:N Lines; Line N:1 ContractLine того же договора. Каждая Allocation относится к продукту своей ContractLine и к той же площадке.
- Vehicle 1:N Shipments. Номер машины фиксируется snapshot независимо от последующего редактирования справочника.
- BusinessDocument 1:0..1 InventoryTransaction; проведённый складской документ обязан иметь ровно одну. Transaction 1:N Movements; каждое исходное движение имеет не более одной полной обратной проводки.
- Роли M:N Users и Permissions через UserRole/RolePermission. UserSiteAccess задаёт область; при необходимости разграничения конкретных складов добавляется нормализованная таблица области доступа после уточнения матрицы.
- StockReservation 1:N ReservationConsumption; расход не превосходит лимит. Reserved balance согласован с суммой активных неиспользованных резервов.

## 13. Inventory Ledger model

`StockMovement.signedQuantityKg`: приход положительный, расход отрицательный; отдельное поле direction не дублируется. Строки ledger append-only. Остаток по lot/location = сумма всех проведённых signed movements, включая обратные проводки. Исключать исходную проводку после сторно нельзя: иначе обратная спишет дважды.

`InventoryBalance.onHandKg` меняется в той же транзакции, что ledger. `availableKg = onHandKg − reservedKg`; статус QUARANTINE/BLOCKED дополнительно запрещает расход. CHECK: onHand ≥ 0, reserved ≥ 0, reserved ≤ onHand. При расходе собственного резерва onHand и reserved уменьшаются согласованно.

Перед первым движением баланс создаётся безопасным upsert с unique key; затем все нужные balance rows блокируются по стабильному порядку. Проверка остатков и запись выполняются под этими блокировками. Права, состояние документа и ограничения договора тоже защищены общей блокировкой агрегата.

| Тип | Проводки |
|---|---|
| PURCHASE_RECEIPT | + raw lot в склад |
| SUPPLIER_RETURN | − исходный purchase lot со склада |
| PRODUCTION_ISSUE | − со склада, + тот же lot в WIP |
| PRODUCTION_RETURN | − из WIP, + тот же lot обратно на склад |
| PRODUCTION_COMPLETION | − потреблённые inputs из WIP, + finished lots, + waste lots; разница документирована |
| WASTE_RETURN | − waste lot из места сбора, + тот же lot на склад отходов |
| WASTE_RECOVERY | − waste input, + recovered material/residual waste lots; разница явно зафиксирована |
| WASTE_REUSE | − waste со склада, + waste в WIP; последующее потребление только в completion |
| WASTE_SALE | − waste lot |
| WASTE_DISPOSAL | − waste lot с основанием |
| PRODUCT_SHIPMENT | − finished product lots |
| TRANSFER | − и + одинаковой массы одного lot между местами |
| ADJUSTMENT / OPENING | Подписанная дельта с причиной/разрешением |
| REVERSAL | Точные противоположные проводки исходной транзакции |

Типы расширяют исходное задание: без PRODUCTION_COMPLETION/WASTE_RECOVERY/WASTE_DISPOSAL нельзя явно выразить потребление, преобразование и утилизацию. Для экрана `PRODUCTION_OUTPUT` является видом положительных строк completion, а не вторым независимым приходом.

Внутреннее перемещение сохраняет массу. Преобразование сохраняет массу с учётом документированной difference. Приход/продажа пересекают границу системы и не требуют фиктивной внутренней второй стороны.

Ежедневная сверка восстанавливает balances из ledger и сравнивает с проекцией. Расхождение блокирует затронутую область для расхода и создаёт диагностическое событие; автоматическая «подгонка» ledger запрещена.

Корректировка принимает counted quantity и ожидаемую версию остатка. Под lock вычисляются before/delta/after. При изменившемся остатке требуется пересчёт, иначе подсчёт, сделанный раньше движения, может затереть корректные операции.

## 14. Purchase Lot model

Приход имеет несколько строк; каждая проведённая строка создаёт собственную закупочную партию. Партия сохраняет источник, цену за kg, валюту и дату через immutable receipt line. Одинаковый материал от разных поставщиков/по разным ценам не объединяется в одну закупочную партию.

Физическое назначение партии и финансовый метод оценки — разные решения. В MVP сотрудник указывает реальные source lots или подтверждённое распределение по ним. Это **не утверждение бухгалтерского метода specific identification**. FIFO/weighted average/оценка восстановленных отходов остаются OPEN QUESTION.

Возврат указывает lot и location. Недоступный или уже потреблённый остаток вернуть нельзя. Возврату из WIP предшествует обратное перемещение неиспользованного сырья. Если материал физически смешивается без возможности определить доли исходных партий, завод должен определить процедуру смешивания и измерения; выдуманное распределение создаст ложную трассировку.

Для будущей себестоимости сохраняются исходные закупочные цены, валюты и граф потребления. Расходы плавки, доставка, курсы валют и распределение стоимости между продукцией/отходами не подменяются нулями и не считаются до утверждения методики.

## 15. ProductionBatch model

Предлагаемые состояния: `DRAFT → READY → IN_PROGRESS → COMPLETED`. `CANCELLED` возможен до потребления с возвратом всего выданного. После completion применяется контролируемое сторно/корректировка с проверкой последующих операций.

Разделяем:

- **Выдано:** перемещение из raw/waste storage в WIP конкретной плавки.
- **Загружено:** фактические ProductionBatchInput; фиксируются на сервере через API.
- **Потреблено:** Input проводится в составе completion; одной записи загрузки недостаточно для второго складского списания.
- **Осталось:** WIP минус потребление; неиспользованное возвращается ProductionReturn.

В первой версии completion атомарен, частичный выпуск внутри плавки не предполагается. Остаток WIP после потребления не исчезает: он виден как неиспользованное сырьё завершённой плавки и может быть только возвращён отдельным ProductionReturn. Если физический цикл требует нескольких выпусков, до реализации нужна модель ProductionRun/partial completions — OPEN QUESTION.

При завершении блокируются batch, inputs и WIP balances. Проверяются оборудование, смена, статусы, неотрицательные quantities и доступность inputs. Записываются completion, потребление, finished/waste lots, difference, genealogy, audit и command receipt одной транзакцией.

Материальный баланс:

`INPUT = FINISHED_OUTPUT + WASTE + OTHER_DIFFERENCE`

OTHER_DIFFERENCE подписанная: положительная — недостача/потеря, отрицательная — превышение измеренного выхода над учтённым входом. Рассчитывается системой; причина, допустимость и порядок утверждения — политика завода. Ненулевая разница без объяснения не должна молча проходить. Рецептуры и норматив 5% не выдумываются.

`Waste % = 100 × Σ wasteKg / Σ inputKg`, при input = 0 → «не определено». Выход и отходы с положительной массой при нулевом input не проводятся обычным completion.

Подтверждены две смены по 12 часов: дневная `[08:00,20:00)` и ночная `[20:00,08:00 следующего дня)`. В 20:00 начинается ночная смена, в 08:00 — дневная. Например, событие 22 сентября в 02:00 относится к ночной смене, начавшейся 21 сентября в 20:00; её businessDate — 21 сентября, дата начала смены (подтверждено владельцем). Расписание хранится двумя записями справочника, без ограничения архитектуры ровно двумя сменами.

ShiftTemplate задаёт локальное расписание и endDayOffset; ShiftInstance фиксирует конкретные UTC-границы и businessDate. Интервалы полуоткрытые `[start,end)`, чтобы событие на границе попало только в одну смену. Изменение расписания не изменяет прошлые ShiftInstance. Для переходов DST явно разрешаются неоднозначные/несуществующие часы.

Плавка может пересечь смену. Сохраняем смену каждого ввода и выпуска, а также ответственную смену batch. До выбора правила отчёт показывает отдельно операции по времени и баланс завершённых партий. Нельзя делить отходы завершившихся плавок на сырьё, выданное за те же часы, если это разные партии.

## 16. Waste lifecycle model

WasteRecord описывает образование отхода и никогда не перезаписывается при его дальнейшей судьбе. WasteLot — учитываемый остаток. Один lot может быть частично возвращён, частично продан, частично использован; поэтому одно поле disposition не является источником истины.

Цепочки:

1. Completion → WasteRecord → WasteLot на месте сбора.
2. RETURN → перемещение того же waste lot на склад; общий запас завода не возрастает.
3. REUSE → выдача waste lot в WIP новой плавки → Input → consumption при completion.
4. RECOVERY → списание исходных отходов → новые recovered material lots + residual waste lots + обоснованная разница.
5. SALE → расход WasteLot + коммерческий документ.
6. DISPOSAL → расход WasteLot + причина/разрешение.

Если склад получает пригодный металл после сортировки, это преобразование с входом и выходом, а не независимый приход «из ничего». Две покупки/плавки не получают один и тот же восстановленный kg.

LotTransformation связывает все inputs и outputs одного события. Граф направлен вперёд по новым партиям: повторное использование материала не создаёт цикл идентификаторов. Исходная WasteLot не становится PurchaseLot. Равенство времени на телефоне не используется для проверки ацикличности.

Аналитика:

- Level 1: total waste / total input для одного и того же набора завершённых партий.
- Level 2: waste type kg / total waste kg; при total waste = 0 проценты «не определены».
- Returned/Reused/Sold/Disposed — отдельные потоки за период. RETURN и REUSE могут последовательно относиться к одной массе; их нельзя складывать как независимые доли от образованных отходов.
- Для остатка: opening + generated + transfers in − transfers out − consumed − sold − disposed ± adjustments = closing.
- Фильтр WasteType не меняет незаметно знаменатель общего waste %; показываются «общие отходы выбранных плавок» и «выбранный вид / общий объём отходов».

## 17. Finished Product Lot model

Каждый ProductionOutput создаёт отдельный FinishedProductLot. StockLot содержит продукт, origin, quality status; Output связывает его с completion/batch/equipment/shift и всей цепью входов.

Одна отгрузка может списывать несколько finished lots через ShipmentAllocation; сумма allocations равна весу ShipmentLine. Один finished lot может отгружаться несколькими машинами в пределах доступного остатка. Отгрузка lot другого продукта или площадки запрещена.

Смешение или переплавка готовой продукции требует явной операции преобразования и новой партии, а не смены batchId существующей. Контроль качества и лаборатория в полный объём MVP не включены; статус QUARANTINE/BLOCKED позволяет не отгружать неподтверждённую продукцию до уточнения процесса.

## 18. Contract model

Contract содержит клиента, номер/дату, валюту, статус, plannedTruckCount и примечания. Product, agreed quantity и price находятся в ContractLine. Это позволяет поддержать несколько продуктов без решения за бизнес: UI может ограничить договор одной строкой до ответа.

Состояния: DRAFT, ACTIVE, CLOSED, CANCELLED. Выполнение — производный показатель, а не отдельная редактируемая колонка. Для каждой строки:

- `agreed = действующее согласованное количество`;
- `shipped = net проведённых отгрузок с учётом допустимых сторно`;
- `remaining = agreed − shipped`;
- `progress = shipped / agreed × 100`, при agreed = 0 → не определено.

Пример: 100 t договор, 20 + 19 + 21 t проведено → 60 t shipped, 40 t remaining, 60%. Planned trucks = 5 не означает лимит 5 или автоматический расчёт по 20 t.

В первой версии предлагается запрет сверхотгрузки без согласованной поправки; это защитная политика для утверждения, не установленное правило предприятия. Изменение активного договора оформляется ContractAmendment с версиями. Количество нельзя уменьшить ниже уже исполненного; новые цены не переписывают старые shipments.

Поддерживаются UZS (узбекский сум) и USD (доллар США). Закупки, договоры, отгрузки и продажи отходов сохраняют валюту документа; отгрузка использует валюту своего договора. Итоги показываются отдельно по UZS и USD, без сложения сумм разных валют. Автоматическая конвертация пока не включается: нужны источник курса, дата курса и правило фиксации. Изменение курса в будущем не переписывает исходные суммы документов. НДС, скидки, оплата и дебиторская задолженность — OPEN QUESTION и вне минимального расчёта сумм.

## 19. Shipment model

Одна Shipment — одно событие отгрузки/рейс по одному договору, несколько строк при необходимости. Повторный рейс той же машины — отдельная Shipment. `count(shipments)` и `count(distinct vehicle)` — разные показатели.

Статусы документа: DRAFT → POSTED либо CANCELLED до проведения. POSTED не редактируется. Факт выезда отмечается отдельно, чтобы проведение и реальный departure не смешивались; точный момент складского списания должен быть утверждён.

Транзакция подтверждения:

1. Проверить authentication, permission, commandId/hash.
2. Заблокировать contract и проверять его текущую версию/статус.
3. Проверить продукт, цены по действующей политике и договорный лимит с учётом всех проведённых shipments.
4. Заблокировать lot/location balances и резервы в общем порядке.
5. Проверить доступность, quality status и сумму allocations.
6. Провести Shipment/Lines/Allocations, snapshot цен и сумм.
7. Создать InventoryTransaction/Movements, обновить balance и собственные резервы.
8. Записать AuditLog и CommandReceipt; commit.

Ошибка любого шага откатывает всё. Lock contract сериализует конкурентные отгрузки даже из разных lots, чтобы вместе они не превысили agreed. Повторное нажатие использует ту же команду, но UI-защита не заменяет серверную идемпотентность.

Сторно отгрузки допустимо только если отражает реальность: после физического выезда может требоваться клиентский возврат, а не отмена. Полный процесс возврата продукции клиентом не указан и остаётся OPEN QUESTION. До его определения запрещено автоматически «возвращать» запас на завод кнопкой отмены.

## 20. Audit model

AuditLog создаётся в транзакции каждого критического изменения. Actor, устройство, время сервера, commandId, действие, сущность, причина и разрешённые before/after snapshots позволяют восстановить последовательность действий.

Бизнес-аудит отделён от технических логов и журналов неуспешного входа. Password/token/secret никогда не включаются в snapshots. Просмотр денежных полей аудита тоже проверяет permission. Системное действие имеет явного system actor/тип инициатора.

Аудит append-only: backend role не получает UPDATE/DELETE для audit и ledger. Миграции используют отдельного владельца. Это защищает от обычных ошибок приложения, но не от администратора БД с полными правами. Если нужна юридически значимая защита от такого вмешательства, потребуется внешнее неизменяемое хранилище/подписанный архив; требование пока не задано.

Для отмены проверяются downstream dependencies: нельзя сторнировать приход, уже ушедший в плавку, без согласованной цепочки коррекции. Первоначальный документ сохраняется. Частичная коррекция оформляется новым delta-документом, а не частично изменёнными исходными ledger rows.

## 21. RBAC model

**В первой версии одна роль — `OWNER` («Владелец»), с доступом ко всем функциям приложения.** Роли ADMIN/DIRECTOR/WAREHOUSE/PRODUCTION/SALES/VIEWER из предварительного предложения не создаются. Количество пользователей с ролью OWNER отдельно не ограничивается этим решением; учётные записи остаются персональными для аудита.

Владелец имеет доступ к закупкам, поставщикам, складу, производству, отходам, клиентам, договорам, продажам, отгрузкам, всем финансовым данным и отчётам, корректировкам, разрешённым отменам, справочникам, настройкам, пользователям и аудиту.

Для последующего расширения сохраняются таблицы Role, Permission, UserRole и RolePermission. OWNER получает весь определённый набор разрешений; новые функции включаются в этот набор вместе с миграцией и проверкой полноты. Отдельный редактор ролей/матрицы прав в MVP не нужен. Пользователю назначается OWNER; дополнительные роли могут быть добавлены позднее.

Полный доступ не отменяет целостность данных: владелец не может провести отрицательный остаток, изменить проведённые ledger rows, обойти идемпотентность или удалить аудит. Исправления доступны через предусмотренные операции со ссылкой на оригинал и обязательной причиной.

Authentication, активность пользователя/устройства и разрешения проверяются сервером. Проверки сохраняются и при единственной роли. В MVP не требуется обязательное согласование вторым сотрудником: владелец выполняет разрешённые подтверждения сам; поля approvedBy сохраняют реального автора действия. Бизнес-правила допустимости отмен и отклонений баланса ещё подлежат уточнению.

## 22. REST API structure

База `/api/v1`, OpenAPI, DTO validation, ограничение размеров, неизвестные поля отклоняются. Критические mutations используют общую инфраструктуру идемпотентности и таблицу CommandReceipt.

| Группа | Основные маршруты |
|---|---|
| Auth | `POST /auth/login`, `/refresh`, `/logout`; `GET /me` |
| Identity | `/users`, `/roles`, `/permissions`, `/devices`; revoke устройства |
| Catalog | `/materials`, `/products`, `/waste-types`, `/warehouses`, `/locations`, `/equipment` |
| Partners | `/suppliers`, `/customers`, `/{id}/history` |
| Purchasing | `/purchase-receipts`, `/{id}/post`, `/purchase-lots`, `/supplier-returns`, `/{id}/post` |
| Inventory | `/inventory/balances`, `/movements`, `/lots/{id}/trace`, `/transfers`, `/reservations`, `/adjustments` |
| Production | `/production/batches`, `/{id}/start`, `/{id}/inputs`, `/{id}/complete`, `/issues`, `/returns` |
| Shifts | `/shift-templates`, `/shift-instances`, `/{id}/close` |
| Waste | `/waste/lots`, `/waste/returns`, `/recoveries`, `/disposals`, `/sales` |
| Sales | `/contracts`, `/{id}/activate`, `/{id}/amendments`, `/shipments`, `/{id}/confirm`, `/vehicles` |
| Corrections | `/documents/{id}/reversal`; обычного DELETE проведённых операций нет |
| Reporting | `/reports/{type}`, `/report-jobs`, `/analytics/dashboard`, `/analytics/waste` |
| Audit | `/audit` с фильтрами сущности/пользователя/даты |
| Результат запроса | `GET /commands/{commandId}` с проверкой доступа |
| Operations | `/health/live`, `/health/ready`, `GET /system/context` |

Критическая mutation передаёт commandId (`Idempotency-Key`), expectedVersion и recoveryEpoch. `PATCH` разрешён для черновиков/справочников с проверкой версии, но не для проведённых количеств.

Ошибка: `{code, message, fieldErrors, retryable, correlationId, details}` без stack/secrets. 400 — формат, 401/403 — доступ, 404 — объект в разрешённой области не найден, 409 — версия/остаток/состояние, 422 — предметная валидация, 429 — ограничение частоты. Складская операция с несколькими строками проводится атомарно; частичного success для неё нет.

Пагинация keyset, например `(occurredAt,id)`, bounded limit. Фильтры дат — `[from,to)`, обязательно с определённой timezone. Сортировка whitelist. Отчёты и dashboard возвращают `snapshotAt`, `generatedAt`, период, валюту и версию определения показателей; фильтры по supplier/material/equipment/product/customer/contract/shift/wasteType применяются только где имеют смысл.

Показатели одного отчёта читаются в согласованном PostgreSQL snapshot (один запрос либо read-only REPEATABLE READ). Для многостраничного экспорта результат фиксируется ReportJob; snapshotAt обозначает время среза, но не заменяет механизм изоляции.

Изменение несовместимой схемы API → новая major version. Сервер поддерживает согласованное окно версий мобильного клиента; неподдерживаемый клиент получает понятное требование обновиться. Серверные черновики и проведённые документы сохраняются.

## 23. Mobile navigation и визуальный дизайн

Подтверждённое требование: красивый, современный интерфейс iPhone. Предлагаемое визуальное направление — спокойная светлая основа, графитовая типографика, один выразительный акцент, ясная иерархия показателей, аккуратные карточки, единая система иконок и достаточно свободного пространства. Цветовая палитра — дизайнерское предложение, а не уже утверждённый бренд.

До масштабирования экранов определить общие design tokens: цвета, типографику, отступы, радиусы, состояния элементов. Базовые компоненты: кнопки, поля веса/валюты, карточки KPI, строки списков, статусы, фильтры, диалоги подтверждения. Главная должна давать быстрый обзор завода; детали доступны по нажатию, без перегрузки карточками и декоративными графиками.

Качество проверяется на реальном рендере React Native в iPhone Simulator: safe areas, клавиатура, прокрутка форм, маленький и большой экран, увеличенный размер текста, читаемость чисел/единиц, загрузка, пустые списки, ошибки и отсутствие сети. Анимации короткие и функциональные, учитывают уменьшение движения; статус не передаётся одним цветом. Визуальные эффекты не задерживают ввод и подтверждение операций.

Simulator используется для запуска iOS-приложения и итераций по скриншотам, а не только для просмотра макета. Проверка на физическом iPhone перед выпуском дополняет симулятор для сценариев устройства и сети. Для Simulator нужен доступный полный Xcode и установленный iOS Simulator runtime; готовность окружения проверяется на этапе foundation.


Для iPhone предлагаются **пять нижних вкладок**: Главная · Склад · Производство · Продажи · Ещё. Шесть вкладок из черновика перегружают нижнюю панель. Отчёты доступны с Главной и в «Ещё», с быстрыми переходами для владельца.

Порядок вкладок стабилен; в первой версии владельцу доступны все разделы и действия, разрешённые текущим состоянием документа. Нет отдельного дублирующего экрана «Продажи продукции», если его сведения уже представлены в договорах/отгрузках.

На каждом рабочем экране: состояние соединения, время данных и результат запроса. Обозначения `Нет соединения`, `Сохранение`, `Результат уточняется`, `Ошибка`, `Подтверждено` различаются текстом, а не только цветом. Tap targets не менее 44 pt, числовая клавиатура, явная kg/t, удобный поиск партии, сохранение черновика на сервере.

Перед проведением — краткое резюме: материал/партия, вес, направление, эффект на остаток, цена при наличии прав. Заблокированная повторная кнопка сопровождается статусом команды. Ошибка не очищает введённые значения. Empty/loading/error states предусмотрены для каждого списка и формы.

## 24. Полный список экранов

Перечень ниже полный для предлагаемого объёма; формы создания/редактирования могут быть одним экраном в разных режимах.

| Область | Экраны |
|---|---|
| Доступ | Вход; загрузка данных; истекшая сессия; смена пароля; недоступная версия приложения |
| Главная | Dashboard; текущая смена; показатели смен; переходы к остаткам/активным договорам; детализация KPI |
| Склад | Остатки; поиск/фильтры; карточка номенклатуры; список партий; карточка партии; трассировка; движения |
| Закупки | Приходы; новый/редактирование черновика; просмотр/подтверждение прихода; закупочная партия; возвраты поставщикам; форма/подтверждение возврата |
| Внутренний склад | Перемещения; форма/подтверждение перемещения; резервы; выдача в производство; возврат из производства; корректировки; форма подсчёта/подтверждения; история/сторно документа |
| Производство | Активные/завершённые плавки; создание; карточка плавки; старт; загрузки; ввод продукции/отходов; проверка баланса; подтверждение completion; WIP остатки; оборудование; смены и закрытие |
| Отходы | Остатки/партии; карточка WasteLot и история; возврат на склад; сортировка/восстановление; повторная выдача в плавку; утилизация; продажи отходов; форма продажи; аналитика и фильтры |
| Продажи | Клиенты; карточка/форма клиента; договоры; карточка/форма договора; строки; активация; изменение договора; прогресс; отгрузки; форма/allocations; подтверждение; карточка рейса; машины |
| Поставщики | Список; карточка/контакты; создание/редактирование; история поставок/возвратов |
| Справочники | Материалы; категории; продукты; виды отходов; склады/места; оборудование; шаблоны смен; формы создания/деактивации |
| Управление | Пользователи с ролью OWNER; карточка пользователя; устройства/отзыв; аудит/детали события; настройки площадки/единиц/часового пояса. Редактор ролей/permissions отложен до расширения ролей |
| Сетевые состояния | Нет соединения; сервер недоступен; уточнение результата запроса; конфликт версии и сравнение; повтор загрузки |
| Профиль | Профиль; безопасность; настройки отображения; диагностика без секретов; информация о версии |
| Отчёты | Каталог; фильтры; результат; drill-down в документ; экспорт/статус экспорта |

Отчёты в каталоге: Warehouse, Purchase, Supplier, Production, Production Batch, Shift, Daily, Waste, Waste Reuse, Finished Product, Customer, Contract, Shipment, Sales. Общий экран отчёта переиспользуется, но определения показателей разные.

Dashboard: текущая смена, input завершённых партий, готовая продукция, отходы/kg/%, количество и сумма отгрузок, покупки, предупреждения остатков и исполнение активных договоров. Владельцу доступны все финансовые карточки; суммы выводятся отдельно в UZS и USD. Для сменных/дневных итогов показываются отдельно сырьё выданное, фактически потреблённое и WIP на конец периода.

Агрегированный waste % = Σ waste / Σ input, а не среднее процентов плавок. «Валовое потребление включая повторную переработку» отделяется от «новое закупленное сырьё»: один металл может проходить через несколько плавок. Разрешённый ввод задним числом меняет историю по occurredAt; отчёт имеет время среза/построения, а закрытие смены требует процедуры сверки.

## 25. VPS/Docker architecture

Провайдера не выбираем. Развёртывание на предоставленном Ubuntu VPS:

- `nginx`: наружу только HTTPS 443; 80 только для redirect/согласованной выдачи сертификата.
- `backend`: NestJS, непривилегированный пользователь, внутренний порт, `/health/live` и `/health/ready`.
- `postgres`: внутренняя Docker network, без публичного published port; постоянный volume.
- `backup`: одноразовое задание по host systemd timer либо выделенный scheduler; постоянное внешнее место назначения.
- `migrate`: отдельный одноразовый шаг релиза с migration-role.

Persistent volumes: postgres data, сертификаты, локальные резервные копии, при необходимости временные экспорты. Экспортам задаются TTL и права доступа. PostgreSQL storage не используется как папка для файлов backup.

Health: live проверяет процесс/event loop без БД; ready выполняет короткий DB check и проверяет совместимую схему. Docker healthchecks не заменяют внешний мониторинг и сами по себе не гарантируют перезапуск unhealthy-контейнера. Restart policy, alerting и процедура восстановления задаются отдельно.

Nginx: TLS, ограничения body/timeouts, security headers, передача request ID и корректный trusted proxy. Настройки CORS — только известные web origins, если web-клиент появится; для native-приложения CORS не является защитой доступа.

Development и production изолированы по БД/секретам. `.env.example` описывает обязательные переменные без настоящих значений. IP, домен, API URL, валюты/таймзона и credentials конфигурируются, а не зашиваются.

Релиз: backup → проверка совместимости → миграция expand → новый backend → readiness → mobile rollout → contract migrations только после окончания поддержки старого клиента. `prisma migrate dev` не запускается в production. На одном VPS возможны краткие остановки и единая точка отказа; требование HA/RTO должно быть согласовано отдельно.

## 26. Security architecture

Пароли: Argon2id с индивидуальной солью и параметрами, проверенными по времени/памяти на VPS. Это соответствует текущей рекомендации [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Password hashes не передаются на телефон.

Access token короткоживущий; refresh token случайный, хранится на сервере только как hash, связан с устройством и семейством ротации. Refresh rotation атомарна; повтор использования старого токена отзывает семейство по утверждённой политике. Клиент сериализует refresh-запросы. Потеря ответа ротации обрабатывается явно: повторный вход либо узко ограниченное безопасное окно восстановления, которое потребуется отдельно протестировать.

Keychain/secure storage хранит refresh token и минимальные маркеры неопределённых результатов запросов; access token предпочтительно в памяти. Ключ локальной бизнес-БД не требуется. Logout очищает пользовательский кэш; маркеры запросов обрабатываются по правилам раздела 7, без передачи действий новому пользователю.

Дополнительно: rate limiting login/refresh и критических API mutations, DTO limits, password policy, защита перебора, RBAC и object-level authorization, parameterized SQL, ограниченная DB-role, секреты вне Git/image/logs, TLS, firewall, обновления зависимостей, отзыв устройств, проверка backup permissions.

Логи structured JSON: requestId, commandId, actorId, route, duration, errorCode; body/token/authorization/cookie не логируются. Доменные ошибки дают безопасную диагностику. Метрики: latency, failed commands, unresolved request age, conflict counts, DB locks/deadlocks, disk, backup age, last restore test, ledger reconciliation failures. Адресаты уведомлений и интеграция мониторинга выбираются отдельно.

## 27. Backup strategy

Минимум: ежедневный согласованный `pg_dump` в persistent host storage и **копия вне VPS**, зашифрованная и с отдельными ключами/доступом. Предложение retention для согласования: 14 daily + 8 weekly + 12 monthly. Проверяются свободное место, exit code, размер, checksum, возраст последней успешной внешней копии.

Только daily dump означает потенциальную потерю почти суток подтверждённых операций. Для завода 24/7 рекомендуется дополнительно base backup + непрерывное архивирование WAL для PITR. Это возможность PostgreSQL, а не гарантия нулевой потери: [PostgreSQL — Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html).

Предлагаемая цель для согласования: RPO ≤ 15 минут и RTO ≤ 4 часов, подтверждённые испытанием. Без согласованного внешнего хранилища и рабочего WAL archive эта цель не заявляется выполненной. Backup на том же диске не защищает от потери VPS.

Restore procedure:

1. Перевести систему в обслуживание, остановить writers и сохранить доступную диагностику.
2. Поднять отдельную БД из выбранной копии/PITR target, восстановить роли/расширения/config из защищённых источников.
3. Проверить миграционную версию, constraints, выборки документов, ledger↔balances, audit/receipts и трассировку.
4. Задать новый recoveryEpoch в конфигурации развёртывания до открытия mutations; определить интервал возможной потери данных. Старые запросы отклоняются до сверки.
5. Сверить операции этого интервала с доступными результатами запросов, независимыми записями и физическими документами; не разрешать автоматические повторы ранее подтверждённых потерянных операций.
6. Переключить backend, принудительно обновить клиентский контекст и данные, открыть API после сверки, проверить отчёты.

Предложение: ежемесячное восстановление в изолированную среду и после изменений backup pipeline. Наличие файла не считается проверкой восстановления. Неотправленные поля открытой формы не входят в backup; приложение явно различает их и сохранённый серверный черновик.

## 28. Testing strategy

Тесты бизнес-правил независимы от UI. Интеграционные тесты используют реальную PostgreSQL, поскольку mocks не проверяют блокировки и типы production-БД.

| Уровень | Обязательные проверки |
|---|---|
| Domain unit | kg/t и обратное преобразование без изменения массы, UZS/USD без смешения итогов, округление по policy, материальный баланс, waste %, breakdown, zero denominator, contract progress |
| Property-based | Остаток воспроизводим из движений; перемещение сохраняет массу; reversal компенсирует оригинал; disposition не расходует больше исходного lot |
| Purchasing | Приход по разным ценам; повтор receipt; частичный возврат; неверный supplier/lot; возврат уже потреблённого |
| Inventory | Projection reconciliation, резервы, новые balance rows, запрет negative, конфликт инвентаризации с движением |
| Production | Issue ≠ consumption; completion создаёт всё атомарно; остаток WIP; возврат; границы 08:00/20:00 и ночная смена через полночь; межсменная плавка; разница баланса; второй completion |
| Waste | Образование → transfer → частичная recovery/reuse/sale/disposal; residual; genealogy; отсутствие двойного прихода |
| Sales | Несколько рейсов, несколько lots, совпадение продукта, суммы, лимит договора, amendments, невозможная отмена после выезда |
| Concurrency | Два расхода последних 500 kg; две отгрузки превышают один contract; гонка completion; общий резерв; deadlock/retry |
| Idempotency | Повтор serial/parallel; тот же ID с другим payload; crash до commit/после commit/до HTTP ответа |
| Network recovery | Потеря ответа после commit; проверка результата по ID; повтор с тем же payload; refresh failure; перезапуск приложения; новый recoveryEpoch |
| Client state | Блокировка mutations без связи; отсутствие отложенной отправки; сохранение формы в текущем сеансе; очистка кэша; изоляция маркеров по пользователю |
| API/security | OWNER имеет все разрешения, включая финансы; неавторизованный/отозванный пользователь не имеет доступа; полный доступ не обходит инварианты; object scope, DTO bounds, rate limits, redaction |
| iPhone E2E | Отправка → потеря ответа → перезапуск → запрос результата → ровно одна проводка; без сети новые операции заблокированы; неверная дата/единица |
| Operations | Deploy migration, backup/restore/PITR, readiness, disk alerts, реальный load profile |

Отдельно проверяется, что отсутствие receipt при ещё выполняющемся запросе не ведёт к созданию новой команды. Устаревший кэш не обходится без серверной проверки версий/остатков; все показатели одного отчёта согласованы в рамках snapshot.

Сценарий приёмки всей цепочки: два поставщика/две цены → приход → часть возврата → выдача → плавка → продукция/отходы/разница → восстановление и повторная плавка → продажа части отходов → несколько отгрузок по договору → сверка ledger, трассировки, смен и сумм. Повторить с потерями сети и параллельными пользователями.

## 29. MVP development stages

Рекомендуемый порядок уточняет исходный: idempotency, обработка сетевых сбоев, audit и тесты внедряются с первой бизнес-операцией, а не в конце. Иначе первые модули придётся переделывать.

| Этап | Результат и критерий выхода |
|---|---|
| 0. Утверждение | Ответы на блокирующие вопросы, согласованная модель и точная команда начала разработки |
| 1. Foundation/prototypes | Monorepo mobile/backend/shared, версии, CI; проверены API client, secure storage и PostgreSQL locks; настроен iPhone Simulator, запущена iOS-сборка и определены design tokens |
| 2. Persistence/security | Миграции, auth/RBAC с единственной ролью OWNER, devices, audit, command receipts; уточнение результата после разрыва связи |
| 3. Первый vertical slice | Supplier + Material + Purchase → lot → ledger → API → отчёт; повтор не дублирует приход |
| 4. Inventory | Возвраты, locations, transfers, корректировки; конкурентный расход и сверка проекции |
| 5. Production | Смены, оборудование, WIP, inputs, completion, finished lots и waste; материальный баланс |
| 6. Waste | Return, recovery, reuse, disposal; частичные количества и полная история |
| 7. Sales | Customers, contracts, shipments, waste sales; лимиты/цены и атомарное списание |
| 8. Reporting/mobile | Все обязательные отчёты, dashboard, фильтры, роли, конфликты версий, сетевые ошибки, пагинация и производительность списков; визуальная проверка экранов в iPhone Simulator |
| 9. Operations | Docker/Nginx/TLS, backup/PITR, мониторинг, инструкции обновления/restore, security review |
| 10. Пилот | Ограниченная группа/площадка, начальные остатки, реальные параллельные смены, сверка с действующим учётом |
| 11. Production readiness | Приёмка, обучение, ответственные за инциденты, доказанные restore/concurrency/network recovery сценарии |

После каждого этапа: build/types, релевантные unit/integration/E2E tests, проверка миграций на чистой БД и обновление предыдущей версии, анализ неизменности инвариантов. При неуспехе следующая фаза не начинается.

Начальные остатки вводятся подписанными OPENING documents с партиями или явным неизвестным происхождением. Переход на новую систему требует cutover time и сверки, чтобы одни движения не попали одновременно как opening и как текущий приход.

В MVP не входят без отдельного решения: бухгалтерия/платежи, прибыль/себестоимость, рецептурная оптимизация, интеграция весов, лаборатория, несколько организаций, HA-кластер. Базовая модель не мешает добавить их позднее, но не заявляет их реализованными.

## 30. OPEN QUESTIONS

Блокирующие вопросы перед реализацией соответствующей предметной области:

1. **Простой связи/VPS:** онлайн-режим уже утверждён пользователем. Каков организационный порядок при недоступном сервере: остановка физических операций либо бумажная регистрация с последующим контролируемым вводом? Кто отвечает за сверку?
2. **Производственный процесс:** выдача непосредственно в котёл или сначала в цех? Бывают ли незагруженные остатки, частичные выпуски, возвраты после старта, несколько плавок одновременно на котле?
3. **Точность — подтверждено:** учёт в целых килограммах; ввод в тоннах допускает до трёх значимых дробных знаков, если результат — целое число kg. Например, 1.250 t = 1250 kg. Учёт штук/длины/упаковки отдельно не заказан.
4. **Баланс:** что входит в input — металл, добавки, уголь, другие материалы? Как отражать окисление/влагу/угар/прибавку массы? Какие отклонения кто утверждает? Шлак и уголь — всегда отход или иногда входной материал?
5. **Смены:** интервалы 08:00–20:00 и 20:00–08:00 по 12 часов подтверждены. Часовой пояс Asia/Tashkent и местоположение Каттакурган подтверждены. Дата ночной смены — дата её начала (подтверждено). Плавка сохраняет смену, выбранную сервером при начале. Открыт вопрос ввода задним числом и исключительных случаев перехода смены.
6. **Партии:** реально ли определить source lot при выдаче? Где смешивают материал, как измеряют доли? Нужны ли сертификаты/качество/карантин?
7. **Финансы:** UZS и USD подтверждены. Осталось определить ввод цены за kg или t, НДС, скидки, точность и порядок округления; нужен ли пересчёт валют и по какому курсу/дате. Метод оценки запасов/себестоимости, расходы плавки и оценка отходов требуют отдельного утверждения.
8. **Отходы:** какие виды допускаются к reuse, нужна ли сортировка, как измеряется выход пригодного материала и остаток; продажа прямо со склада или по договору; кто утверждает disposal?
9. **Договоры:** один или несколько продуктов, частичные отгрузки формально разрешены, допустим ли перевес/недовес, как согласуются изменения цены/количества?
10. **Отгрузка:** в какой момент списывать — взвешивание, оформление или выезд? Нужны gross/tare/net, водитель, весовая интеграция, один рейс по нескольким договорам, клиентские возвраты?
11. **Отмена/корректировки:** доступ к подтверждению есть у владельца. Осталось определить допустимость действий задним числом, закрытые периоды, основания отмен и обязательные документы. Второй согласующий в MVP не требуется.
12. **Пользователи/устройства:** единственная роль OWNER с полным доступом подтверждена; матрица ограничений для других ролей сейчас не нужна. Осталось уточнить количество персональных учётных записей и использование общих либо личных устройств.

Вопросы, не мешающие согласовать общую архитектуру:

13. Полные справочники сырья, продуктов, отходов, котлов, складов/мест и контрагентов; правила нумерации.
14. Число пользователей/устройств/площадок, операции в сутки, история в годах, целевое время ответа API, максимальный размер документа.
15. Нужна ли история только в приложении или Excel/PDF exports; языки интерфейса; какие KPI директор использует ежедневно?
16. Каким способом распространяется iOS-приложение, кто владеет Apple signing/учётной записью, какие минимальные iOS и устройства поддерживаются?
17. Сроки хранения аудита/документов, требования к персональным данным и внешнему immutable архиву.
18. VPS/domain/SSH предоставляются позднее. Сейчас нужны целевые RPO/RTO, внешнее место backup, ответственный за restore и мониторинг; допустим ли единый VPS как точка отказа?
19. Как вводятся начальные остатки и подтверждается их происхождение/стоимость; дата перехода и период параллельного учёта?

До ответов не выбираются произвольные финансовые нормативы, FIFO, проценты потерь или полномочия сотрудников. Для первого прохода согласования важнее всего вопросы 1–6 и 9–12.

**Разработка разрешена пользователем.** Реализация идёт поэтапно с проверками. OPEN QUESTIONS уточняются перед соответствующими производственными и финансовыми сценариями.


### Уточнение владельца от 21.09.2026

Килограммы — целые. Ночная смена относится к дате начала. После плавки обязательно учитываются отходы. Текущая реализация требует положительный выпуск продукции и хотя бы один положительный выход отходов, с равенством массы входа и суммы выходов. Допуск для необъяснённой разницы и норматив технологических потерь не выдумываются: такая плавка остаётся незавершённой до уточнения фактического результата.
