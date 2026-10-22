import { glassStyles, GlassModal as Modal, useModalDismiss } from "./glass-ui";
import { SafeAreaView } from "react-native-safe-area-context";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Decimal from "decimal.js";
import { Ionicons } from "@expo/vector-icons";
import { api, mutate } from "./api";
import { MonthOpening } from "./month-opening";
import { confirmAction } from "./confirm-action";
import { theme as c } from "./theme";
const fmt = (v: any) =>
  new Decimal(v ?? 0)
    .toDecimalPlaces(3)
    .toFixed()
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const status = (v: string) =>
  (
    ({
      POSTED: "Проведено",
      REVERSED: "Отменено",
      IN_PROGRESS: "В работе",
      COMPLETED: "Завершено",
      RETURNED: "Металл возвращён",
      CANCELLED: "Отменено",
    }) as Record<string, string>
  )[v] ?? v;
const kind = (v: string) =>
  (
    ({
      MATERIAL: "Сырьё",
      PRODUCT: "Готовая продукция",
      WASTE: "Отходы",
    }) as Record<string, string>
  )[v] ?? "Металл";
const operation = (v: string) =>
  (
    ({
      PURCHASE: "Приход",
      PURCHASE_RECEIPT: "Приход",
      PURCHASE_CORRECTION: "Правка прихода",
      ADJUSTMENT: "Инвентаризация",
      KETTLE_RECOVERY: "Возврат из котла",
      TRANSFER_IN: "Перемещение: приём",
      TRANSFER_OUT: "Перемещение: выдача",
      PRODUCTION_INPUT: "Загрузка котла",
      PRODUCTION_CONSUMPTION: "Расход в производстве",
      PRODUCTION_OUTPUT: "Выпуск",
      SHIPMENT: "Отгрузка",
      WASTE_SALE: "Продажа отходов",
      WASTE_DISPOSAL: "Утилизация",
      MONTH_CLOSE: "Обнуление складов при закрытии",
      MONTH_OPENING: "Ввод фактических остатков",
    }) as Record<string, string>
  )[v] ?? "Учётная операция";
const date = (v: string) =>
  new Date(v).toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const money = (v: any) =>
  !v?.known
    ? "Стоимость не определена"
    : Object.entries(v.amounts)
        .map(([currency, amount]) => `${fmt(amount)} ${currency}`)
        .join(" + ") || "0";
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={s.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={s.row}
      >
        <Text style={s.title}>{title}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={c.blue}
        />
      </Pressable>
      {open && <View style={{ gap: 12, marginTop: 14 }}>{children}</View>}
    </View>
  );
}
function Summary({ data }: { data: any }) {
  return (
    <View style={s.card}>
      <Text style={s.title}>Итоги периода</Text>
      <Row label="Приходов" value={String(data.receipts)} />
      <Row label="Получено до возврата" value={`${fmt(data.grossKg)} кг`} />
      <Row label="Возвраты" value={`${fmt(data.returnedKg)} кг`} />
      <Row label="Скидки" value={`${fmt(data.discountKg)} кг`} />
      <Row label="Принято на склад" value={`${fmt(data.receivedKg)} кг`} />
      {data.purchaseAmounts.map((r: any) => (
        <Row
          key={r.currency}
          label={`Закупки · ${r.currency}`}
          value={fmt(r.amount)}
        />
      ))}
      {!!data.unpriced && (
        <Text style={s.note}>
          Без цены: {data.unpriced} поз. · стоимость закупок неполная
        </Text>
      )}
      <Row label="Завершено плавок" value={String(data.completedBatches)} />
      <Row label="Произведено" value={`${fmt(data.productKg)} кг`} />
      <Row label="Отходы" value={`${fmt(data.wasteKg)} кг`} />
      <Row label="Безвозвратные потери" value={`${fmt(data.lossKg)} кг`} />
      <Row label="Отгрузок" value={String(data.shipments)} />
      <Row label="Продано / отгружено" value={`${fmt(data.soldKg)} кг`} />
      {data.saleAmounts.map((r: any) => (
        <Row
          key={r.currency}
          label={`Продажи · ${r.currency}`}
          value={fmt(r.amount)}
        />
      ))}
      <Row label="Остатки на складах" value={`${fmt(data.stockKg)} кг`} />
      <Row label="В котлах" value={`${fmt(data.wipKg)} кг`} />
      <Row label="Стоимость всех остатков" value={money(data.stockValue)} />
    </View>
  );
}
function Stock({ rows }: { rows: any[] }) {
  return (
    <>
      {rows.length ? (
        rows.map((r) => (
          <View key={`${r.lotId}:${r.locationId}`} style={s.line}>
            <Text style={s.title}>{r.lot.item.name}</Text>
            <Text style={s.note}>
              {r.location.name} · {r.location.warehouse?.name} ·{" "}
              {kind(r.lot.stockKind ?? r.lot.item.kind)}
            </Text>
            <Row label="Остаток" value={`${fmt(r.onHandKg)} кг`} />
            <Row label="Зарезервировано" value={`${fmt(r.reservedKg)} кг`} />
            <Row label="Стоимость" value={money(r.value)} />
          </View>
        ))
      ) : (
        <Text style={s.note}>Остатков нет</Text>
      )}
    </>
  );
}
export function MonthClosing({
  onChanged,
  onInventory,
}: {
  onChanged: () => void;
  onInventory: () => void;
}) {
  const [preview, setPreview] = useState<any>(null),
    [archive, setArchive] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null);
  const { closing: archiveClosing, dismiss: dismissArchive } = useModalDismiss(!!selected);
  const closeArchive = () => dismissArchive(() => setSelected(null));
  const [busy, setBusy] = useState(false),
    [closing, setClosing] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const [p, a] = await Promise.all([
        api("/month-closes/preview"),
        api<any[]>("/month-closes"),
      ]);
      setPreview(p);
      setArchive(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function close() {
    setClosing(true);
    setError("");
    try {
      const result = await mutate(
        "/month-closes",
        preview.previous ? { previousId: preview.previous.id } : {},
      );
      const saved = await api(`/month-closes/${(result as any).id}`);
      setSelected(saved);
      await load();
      onChanged();
    } catch (e) {
      const message = (e as Error).message;
      await load();
      setError(message);
    } finally {
      setClosing(false);
    }
  }
  const button = (
    label: string,
    action: () => void,
    primary = false,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={action}
      style={[
        s.button,
        primary && { backgroundColor: c.blue },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={{ color: primary ? "white" : c.blue, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
  const doc = selected?.snapshot;
  const content = (
    <View style={{ gap: 14 }}>
      <Text style={{ fontSize: 24, fontWeight: "700", color: c.ink }}>
        Закрытие месяца
      </Text>
      <Text style={s.note}>
        Закрытый отчёт сохраняет историю, остатки и суммы. Склады обнуляются;
        новый период начинается с фактических остатков. Время — Ташкент.
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#B43F36" }}>
          {error}
        </Text>
      )}
      {busy && <ActivityIndicator color={c.blue} />}
      {selected ? (
        <>
          {button("← Текущий период и архив", () => closeArchive())}
          <View style={[s.card, { backgroundColor: c.softBlue }]}>
            <Text style={s.title}>Закрытый отчёт №{selected.number}</Text>
            <Text style={s.note}>
              {date(selected.from)} — {date(selected.to)}
            </Text>
            <Text style={s.note}>Закрыл: {selected.ownerName}</Text>
            <Text style={s.note}>
              Неизменяемый снимок. Последующие правки не меняют этот отчёт.
            </Text>
          </View>
          <Summary data={doc.summary} />
          <Section title={`Остатки на закрытие · ${doc.closingStock.length}`}>
            <Stock rows={doc.closingStock} />
          </Section>
          <Section title="Остатки на начало">
            <Stock rows={doc.openingStock} />
          </Section>
          <Section title={`Приходы · ${doc.purchases.length}`}>
            {doc.purchases.map((r: any) => (
              <View key={r.id} style={s.line}>
                <Text style={s.title}>
                  Приход №{r.number} ·{" "}
                  {r.supplier?.name ??
                    r.lines[0]?.supplierName ??
                    "Без поставщика"}
                </Text>
                <Text style={s.note}>
                  {date(r.postedAt)} · {status(r.status)}
                </Text>
                {r.lines.map((l: any) => (
                  <View key={l.id}>
                    <Row
                      label={l.material.name}
                      value={`${fmt(l.quantityKg)} кг`}
                    />
                    <Row
                      label="Возврат / скидка"
                      value={`${fmt(l.returnedKg)} / ${fmt(new Decimal(l.discountKg).plus(l.percentDiscountKg))} кг`}
                    />
                    <Row
                      label="Сумма"
                      value={
                        l.priceKnown
                          ? `${fmt(l.amount)} ${l.currency}`
                          : "Цена не указана"
                      }
                    />
                  </View>
                ))}
              </View>
            ))}
          </Section>
          <Section title={`Производство · ${doc.production.length}`}>
            {doc.production.map((b: any) => (
              <View key={b.id} style={s.line}>
                <Text style={s.title}>
                  {b.equipment.name} · {b.number}
                </Text>
                <Text style={s.note}>
                  {status(b.status)} · {b.shift.name}
                </Text>
                {b.inputs.map((i: any) => (
                  <Row
                    key={i.id}
                    label={`Загрузка · ${i.lot.item.name}`}
                    value={`${fmt(i.quantityKg)} кг`}
                  />
                ))}
                {b.outputs.map((o: any) => (
                  <Row
                    key={o.id}
                    label={o.lot.item.name}
                    value={`${fmt(o.quantityKg)} кг · ${money(o.value)}`}
                  />
                ))}
                {b.recovery && (
                  <Row
                    label="Извлечено и возвращено на склад"
                    value={`${fmt(b.recovery.actualKg)} кг`}
                  />
                )}
                <Row
                  label="Расчётный остаток в котле"
                  value={`${fmt(b.carryoverKg)} кг`}
                />
                <Row
                  label="Безвозвратные потери"
                  value={`${fmt(b.differenceKg)} кг`}
                />
                <Row label="Стоимость загрузки" value={money(b.totalCost)} />
              </View>
            ))}
          </Section>
          <Section title={`Продажи и отгрузки · ${doc.shipments.length}`}>
            {doc.shipments.map((r: any) => (
              <View key={r.id} style={s.line}>
                <Text style={s.title}>{r.customer?.name ?? "Без клиента"}</Text>
                <Text style={s.note}>
                  {date(r.document.occurredAt)} · {status(r.document.status)}
                  {r.departedAt ? " · Выехала" : " · Не выехала"}
                </Text>
                {r.lines.map((l: any) => (
                  <Row
                    key={l.id}
                    label={l.item.name}
                    value={`${fmt(l.quantityKg)} кг · ${fmt(l.amount)} ${r.currency}`}
                  />
                ))}
              </View>
            ))}
          </Section>
          <Section title={`Движения и корректировки · ${doc.movements.length}`}>
            {doc.movements.map((r: any) => (
              <View key={r.id} style={s.line}>
                <Text style={s.note}>
                  {date(r.postedAt)} · {operation(r.type)}
                </Text>
                <Row
                  label={`${r.lot.item.name} · ${r.location.name}`}
                  value={`${fmt(r.signedQuantityKg)} кг`}
                />
              </View>
            ))}
            {doc.adjustments.map((d: any) => (
              <View key={d.id}>
                <Text style={s.title}>{operation(d.type)}</Text>
                <Text style={s.note}>{d.reason ?? ""}</Text>
                <Row
                  label="До / после"
                  value={`${fmt(d.adjustmentBeforeKg)} / ${fmt(d.adjustmentAfterKg)} кг`}
                />
                {d.purchaseRevision && (
                  <Row
                    label={d.purchaseRevision.line.material.name}
                    value={`${fmt(d.purchaseRevision.amount)} ${d.purchaseRevision.currency}`}
                  />
                )}
              </View>
            ))}
          </Section>
          <Section title={`Договоры · ${doc.contracts.length}`}>
            {doc.contracts.map((r: any) => (
              <View key={r.id}>
                <Text style={s.title}>
                  {r.number} · {r.customer.name}
                </Text>
                {r.lines.map((l: any) => (
                  <Row
                    key={l.id}
                    label={l.item.name}
                    value={`${fmt(l.agreedQuantityKg)} кг`}
                  />
                ))}
              </View>
            ))}
          </Section>
        </>
      ) : (
        <>
          {preview?.openingPending && (
            <MonthOpening
              onSaved={() => {
                void load();
                onChanged();
              }}
            />
          )}
          {preview && !preview.openingPending && (
            <>
              <View style={s.card}>
                <Text style={s.title}>Открытый период</Text>
                <Text style={s.note}>
                  {date(preview.from)} — по настоящее время
                </Text>
                <Text style={s.note}>
                  При закрытии все складские остатки и их стоимость сохранятся в
                  отчёте. Затем склады станут пустыми — вы введёте фактические
                  остатки нового периода. Сырьё в котлах и резервы нужно
                  оформить до закрытия.
                </Text>
                {button("Проверить склады", onInventory)}
                {button(
                  "Обновить итоги",
                  () => void load(),
                  false,
                  busy || closing,
                )}
              </View>
              <Summary data={preview.summary} />
              <Section title="Проверить остатки перед закрытием">
                <Stock rows={preview.stock} />
              </Section>
              {preview.blockers?.map((message: string) => (
                <Text key={message} style={{ color: "#B43F36" }}>
                  {message}
                </Text>
              ))}
              {button(
                closing ? "Закрытие…" : "Закрыть месяц и сохранить отчёт",
                () =>
                  confirmAction({
                    title: "Закрыть текущий период?",
                    message: `Будет сохранён отчёт с ${date(preview.from)} по момент подтверждения. Все склады (сырьё, продукция, отходы) обнулятся. Старые веса и суммы останутся в закрытом отчёте. Затем нужно ввести фактические остатки и подтвердить пересчёт. Если месяц ещё не закончился, закроется только прошедшая часть месяца.`,
                    confirmText: "Закрыть период",
                    onConfirm: close,
                  }),
                true,
                busy ||
                  closing ||
                  (!preview.operations && !preview.stock.length) ||
                  !!preview.blockers?.length,
              )}
            </>
          )}
          <Text style={s.title}>Архив закрытых отчётов</Text>
          {!archive.length && (
            <Text style={s.note}>Пока нет закрытых периодов</Text>
          )}
          {archive.map((r) => (
            <Pressable
              key={r.id}
              style={s.card}
              accessibilityRole="button"
              onPress={() => {
                setBusy(true);
                setError("");
                void api(`/month-closes/${r.id}`)
                  .then(setSelected)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <View style={s.row}>
                <Text style={s.title}>Отчёт №{r.number}</Text>
                <Ionicons name="chevron-forward" color={c.blue} size={18} />
              </View>
              <Text style={s.note}>
                {date(r.from)} — {date(r.to)}
              </Text>
              <Text style={s.note}>{r.ownerName}</Text>
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
  return selected ? (
    <Modal
      visible={!archiveClosing}
      animationType="slide"
      onRequestClose={() => closeArchive()}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView
          key={selected.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        >
          {content}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  ) : (
    content
  );
}
const s = StyleSheet.create({
  card: {
    ...glassStyles.card,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: c.line,
  },
  title: { fontSize: 15, fontWeight: "700", color: c.ink, flexShrink: 1 },
  note: { fontSize: 12, lineHeight: 19, color: c.muted },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 4,
  },
  label: { fontSize: 13, color: c.muted, flex: 1 },
  value: {
    fontSize: 13,
    fontWeight: "600",
    color: c.ink,
    textAlign: "right",
    flex: 1,
  },
  button: {
    minHeight: 44,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: "center",
    backgroundColor: c.white,
  },
  line: {
    gap: 6,
    borderBottomWidth: 1,
    borderColor: c.line,
    paddingBottom: 12,
  },
});
