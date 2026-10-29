import { Collapsible } from "./collapsible";
import { glassStyles } from "./glass-ui";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Decimal from "decimal.js";
import { api } from "./api";
import { loadKettleReports, type ReportKettle } from "./production-period-data";
import { DateTimeField } from "./date-time-field";
import { theme as c } from "./theme";

type Cost = { known: boolean; amounts: Record<string, string> };
type Report = {
  batchCount: number; inputKg: string; freshInputKg: string; incomingCarryoverKg: string; productKg: string;
  wasteKg: string; wastePercent: string | null; reusedWasteKg: string; netWasteKg: string;
  lossKg: string; lossPercent: string | null; carryoverKg: string; recoveryDifferenceKg: string;
  inputCost: Cost; productCost: Cost; averageUnitCost: Cost | null; carryoverCost: Cost;
  products: { id: string; name: string; quantityKg: string; cost: Cost; unitCost: Cost | null }[];
  wastes: { id: string; name: string; quantityKg: string }[];
};
const number = (value: string, places = 3) => new Decimal(value).toDecimalPlaces(places).toFixed().replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const kg = (value: string) => `${number(value)} кг`;
const money = (value: Cost | null) => !value ? "—" : !value.known ? "Стоимость не определена" : Object.entries(value.amounts).map(([currency, amount]) => `${number(amount, 2)} ${currency}`).join(" + ") || "0";
const date = (value: string) => `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)} ${value.slice(11)}`;
const Row = ({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) => <View style={[styles.row, accent && styles.accent]}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;

export function ProductionPeriodReport({ refreshKey, onActiveChange, equipment }: { refreshKey: number; onActiveChange: (active: boolean) => void; equipment: ReportKettle[] }) {
  const today = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01T00:00`);
  const [to, setTo] = useState(`${today}T23:59`);
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [reports, setReports] = useState<{ equipment: ReportKettle; report: Report }[] | null>(null);
  const equipmentKey = JSON.stringify(equipment.map(({ id, name }) => ({ id, name })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!applied) return;
    let current = true;
    setBusy(true); setError(""); setReports(null);
    const start = new Date(`${applied.from}:00+05:00`).toISOString();
    const end = new Date(new Date(`${applied.to}:00+05:00`).getTime() + 60000).toISOString();
    void loadKettleReports<Report>(JSON.parse(equipmentKey), `from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`, path => api<Report>(path))
      .then(result => { if (current) setReports(result); })
      .catch(e => { if (current) setError(e.message); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [applied, refreshKey, equipmentKey]);
  function apply() {
    const start = new Date(`${from}:00+05:00`), end = new Date(`${to}:00+05:00`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
      setError("Выберите корректные даты: начало должно быть не позже окончания."); return;
    }
    setError(""); setReports(null); setApplied({ from, to }); setExpanded(false); onActiveChange(true);
  }
  function reset() {
    setApplied(null); setReports(null); setError(""); setBusy(false); setExpanded(false); onActiveChange(false);
  }
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel="Выбрать период завершённых плавок" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.header}>
      <View style={styles.icon}><Ionicons name="calendar-outline" size={21} color={c.blue} /></View>
      <View style={{ flex: 1 }}><Text style={styles.title}>{applied ? "Отчёты по котлам за период" : "Отчёты по завершённым плавкам"}</Text><Text style={styles.hint}>{applied ? `${date(applied.from)} — ${date(applied.to)}` : "Выберите период завершения"}</Text></View>
      <Ionicons name={expanded ? "chevron-up" : "options-outline"} size={21} color={c.blue} />
    </Pressable>
    <Collapsible open={expanded}><View style={styles.filters}>
      <Text style={styles.hint}>По времени завершения плавки · Ташкент. Последняя выбранная минута включается полностью.</Text>
      <Text style={styles.label}>С даты и времени</Text><DateTimeField label="Начало периода завершённых плавок" value={from} onChange={setFrom} />
      <Text style={styles.label}>По дату и время</Text><DateTimeField label="Конец периода завершённых плавок" value={to} onChange={setTo} />
      <Pressable accessibilityRole="button" onPress={apply} style={styles.apply}><Text style={styles.applyText}>Показать отчёты по котлам</Text></Pressable>
    </View></Collapsible>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {busy && <ActivityIndicator style={{ margin: 16 }} color={c.blue} />}
    {reports?.length === 0 && <Text style={styles.hint}>За выбранный период завершённых плавок нет.</Text>}
    {reports?.map(({ equipment: kettle, report }) => <View key={kettle.id} style={styles.kettleReport}>
      <View style={styles.kettleHeader}>
        <View style={styles.icon}><Ionicons name="flame-outline" size={22} color={c.blue} /></View>
        <Text accessibilityRole="header" style={styles.kettleName}>{kettle.name}</Text>
      </View>
      <Row label="Завершено плавок" value={String(report.batchCount)} accent />
      <Text style={styles.section}>Загрузка и стоимость</Text>
      <Row label="Сырьё и отходы извне периода" value={kg(report.freshInputKg)} />
      <Row label="Остаток предыдущих смен, пришедший в период" value={kg(report.incomingCarryoverKg)} />
      <Row label="Всего без повторного учёта" value={kg(report.inputKg)} />
      <Row label="Стоимость сырья и входящего остатка" value={money(report.inputCost)} />
      <Text style={styles.section}>Готовая продукция</Text>
      <Row label="Общий выпуск" value={kg(report.productKg)} accent />
      <Row label="Средняя себестоимость продукции и остатка за кг" value={money(report.averageUnitCost)} accent />
      {report.products.map(product => <View key={product.id} style={styles.group}>
        <Row label={product.name} value={kg(product.quantityKg)} />
        <Row label="Себестоимость за кг" value={money(product.unitCost)} />
      </View>)}
      <Text style={styles.section}>Отходы и потери</Text>
      <Row label="Получено отходов" value={`${kg(report.wasteKg)}${report.wastePercent !== null ? ` · ${number(report.wastePercent, 2)} %` : ""}`} />
      {report.wastes.map(waste => <Row key={waste.id} label={waste.name} value={kg(waste.quantityKg)} />)}
      {new Decimal(report.reusedWasteKg).gt(0) && <>
        <Row label="Из них повторно использовано внутри периода" value={kg(report.reusedWasteKg)} />
        <Row label="Отходы за вычетом повторного использования" value={kg(report.netWasteKg)} />
      </>}
      <Row label="Безвозвратные потери" value={`${kg(report.lossKg)}${report.lossPercent !== null ? ` · ${number(report.lossPercent, 2)} %` : ""}`} />
      <Text style={styles.section}>Остаток за границей периода</Text>
      <Row label="Передано следующим сменам / возвращено на склад" value={kg(report.carryoverKg)} />
      {new Decimal(report.recoveryDifferenceKg).isZero() ? null : <Row label="Уточнение веса при извлечении из котла" value={kg(report.recoveryDifferenceKg)} />}
      <Text style={styles.hint}>Передачи между плавками этого котла внутри отчёта не считаются новой загрузкой. Средняя себестоимость = общая стоимость входящих материалов ÷ (вес продукции + переходящий остаток). Проценты — от загрузки без повторов. UZS и USD учитываются отдельно.</Text>
    </View>)}
    {!!applied && <Pressable accessibilityRole="button" onPress={reset} style={styles.reset}><Ionicons name="list-outline" size={18} color={c.blue} /><Text style={styles.resetText}>Вернуться к отдельным плавкам</Text></Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  card: { ...glassStyles.card, padding: 14, marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.softBlue, alignItems: "center", justifyContent: "center" },
  title: { color: c.ink, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  hint: { color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  filters: { marginTop: 12, gap: 9 },
  label: { flex: 1, color: c.muted, fontSize: 13, lineHeight: 19 },
  value: { flex: 1, color: c.ink, textAlign: "right", fontSize: 13, lineHeight: 19, fontWeight: "600" },
  apply: { backgroundColor: c.blue, padding: 13, borderRadius: 12, alignItems: "center", marginTop: 5 },
  applyText: { color: c.white, fontWeight: "700", fontSize: 14 },
  kettleReport: { ...glassStyles.control, backgroundColor: c.bg, padding: 14, marginTop: 16, borderRadius: 20, gap: 3 },
  kettleHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  kettleName: { flex: 1, color: c.ink, fontSize: 17, lineHeight: 24, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8 },
  accent: { backgroundColor: c.softBlue, paddingHorizontal: 9, borderRadius: 10 },
  section: { color: c.ink, fontSize: 14, lineHeight: 20, fontWeight: "700", marginTop: 16, marginBottom: 5 },
  group: { borderTopWidth: 1, borderColor: c.line, marginTop: 8, paddingTop: 5 },
  reset: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", minHeight: 44, marginTop: 14 },
  resetText: { color: c.blue, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  error: { color: "#B84040", fontSize: 13, lineHeight: 19, marginTop: 12 },
});
