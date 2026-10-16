import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Decimal from "decimal.js";
import { api } from "./api";
import { DateTimeField } from "./date-time-field";
import { theme as c } from "./theme";

type Period = { from: string; to: string };
type Summary = { receipts: number; lines: number; grossKg: string; returnedKg: string; discountKg: string; acceptedKg: string; payableKg: string; unpriced: number; amounts: { currency: string; amount: string }[] };
const fmt = (v: string) => { const [whole, fraction] = new Decimal(v).toFixed().split("."); return whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (fraction ? `,${fraction}` : ""); };
const wall = (d: Date) => new Date(d.getTime() + 5 * 3600000).toISOString().slice(0, 16);
const periodLabel = (v: string) => new Date(v).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export function RawGroupCard({ category, name, quantityKg, refreshKey }: { category: string; name: string; quantityKg?: string; refreshKey?: string }) {
  const [period, setPeriod] = useState<Period | null>(null);
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState("");
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const color = category === "KIZIL" ? "#AB4B39" : "#927024";
  const backgroundColor = category === "KIZIL" ? "#FFF1EC" : "#FFF8E5";
  useEffect(() => {
    const request = ++sequence.current;
    if (!period) { setSummary(null); setError(""); setBusy(false); return; }
    setBusy(true); setError("");
    api<Summary>(`/dashboard/raw-group?category=${category}&from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`)
      .then(data => { if (sequence.current === request) setSummary(data); })
      .catch(e => { if (sequence.current === request) setError(e.message); })
      .finally(() => { if (sequence.current === request) setBusy(false); });
    return () => { sequence.current++; };
  }, [category, period, refreshKey, retry]);
  const row = (label: string, value: string) => <View style={s.row}><Text style={s.label}>{label}</Text><Text style={s.value}>{value}</Text></View>;
  function begin() {
    setDraft(period ? { from: wall(new Date(period.from)), to: wall(new Date(period.to)) } : { from: `${wall(new Date()).slice(0,7)}-01T00:00`, to: wall(new Date()) });
    setDraftError(""); setOpen(true);
  }
  return <View style={[s.card, { backgroundColor }]}>
    <View style={s.row}>
      <Text style={[s.title, { color }]}>{name}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Выбрать период ${name}`} onPress={begin} style={s.periodButton}>
        <Ionicons name="calendar-outline" color={color} size={17} /><Text style={{ color, fontSize: 13, fontWeight: "600" }}>Период</Text>
      </Pressable>
    </View>
    {!period ? <>
      <Text style={s.label}>Текущий остаток</Text>
      <Text style={s.weight}>{quantityKg !== undefined ? `${fmt(new Decimal(quantityKg).div(1000).toString())} т` : "—"}</Text>
      <Text style={s.label}>{quantityKg !== undefined ? `${fmt(quantityKg)} кг` : "Загрузка"}</Text>
    </> : <>
      <Text style={s.dates}>{periodLabel(period.from)} — {periodLabel(period.to)}</Text>
      {busy ? <ActivityIndicator color={color} /> : error ? <Pressable onPress={() => setRetry(n=>n+1)}><Text style={{ color: "#B33E35" }}>{error} · Повторить</Text></Pressable> : summary && <>
        <Text style={s.label}>Принято на склад за период</Text>
        <Text style={s.weight}>{fmt(summary.acceptedKg)} кг</Text>
        {row("Приходов / позиций", `${summary.receipts} / ${summary.lines}`)}
        {row("Получено до возврата", `${fmt(summary.grossKg)} кг`)}
        {row("Возвраты", `${fmt(summary.returnedKg)} кг`)}
        {row("Скидки · вручную и %", `${fmt(summary.discountKg)} кг`)}
        {row("К оплате по весу", `${fmt(summary.payableKg)} кг`)}
        {summary.amounts.map(a => <View key={a.currency}>{row("Сумма закупок", `${fmt(new Decimal(a.amount).toDecimalPlaces(2).toString())} ${a.currency}`)}</View>)}
        {!summary.receipts && <Text style={s.label}>За этот период приходов нет</Text>}
        {!!summary.unpriced && <Text style={s.label}>Без цены: {summary.unpriced} поз. · итоговая сумма неполная</Text>}
        <Text style={s.dates}>Поступления за период, не текущий остаток. Группы — по текущей настройке сырья.</Text>
      </>}
      <Pressable accessibilityRole="button" onPress={() => setPeriod(null)} style={s.reset}><Text style={{ color, fontWeight: "600" }}>Показать текущий остаток</Text></Pressable>
    </>}
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={s.overlay}>
        <View style={s.modal}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, padding: 20 }}>
            <Text style={s.title}>{name} · период приходов</Text>
            <Text style={s.label}>Дата и время Ташкента · окончание включительно</Text>
            <Text style={s.label}>С даты и времени</Text><DateTimeField label={`Начало периода ${name}`} value={draft.from} onChange={from=>setDraft(d=>({...d,from}))} />
            <Text style={s.label}>По дату и время</Text><DateTimeField label={`Конец периода ${name}`} value={draft.to} onChange={to=>setDraft(d=>({...d,to}))} />
            {!!draftError && <Text style={{color:"#B33E35"}}>{draftError}</Text>}
            <Pressable accessibilityRole="button" style={s.apply} onPress={() => {
              const from = new Date(`${draft.from}:00+05:00`), to = new Date(`${draft.to}:59.999+05:00`);
              if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) { setDraftError("Проверьте даты: начало должно быть раньше окончания."); return; }
              setSummary(null); setPeriod({from:from.toISOString(),to:to.toISOString()}); setOpen(false);
            }}><Text style={{color:"white",fontWeight:"700"}}>Применить</Text></Pressable>
            <Pressable accessibilityRole="button" style={s.reset} onPress={()=>setOpen(false)}><Text style={s.value}>Отмена</Text></Pressable>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}
const s = StyleSheet.create({
  card:{borderRadius:16,padding:16,gap:8}, row:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:12},
  title:{fontSize:17,fontWeight:"700",color:c.ink}, periodButton:{flexDirection:"row",gap:6,alignItems:"center",padding:9,borderRadius:10,backgroundColor:"#FFFFFFAA",minHeight:40},
  label:{fontSize:12,lineHeight:18,color:c.muted,flexShrink:1}, value:{fontSize:13,fontWeight:"600",color:c.ink,textAlign:"right",flexShrink:1},
  weight:{fontSize:27,lineHeight:36,fontWeight:"700",color:c.ink}, dates:{fontSize:11,lineHeight:17,color:c.muted},
  reset:{paddingVertical:10,alignItems:"center",minHeight:40}, overlay:{flex:1,backgroundColor:"#00000066",justifyContent:"center",padding:16},
  modal:{backgroundColor:c.white,borderRadius:20,maxHeight:"90%",width:"100%",maxWidth:500,alignSelf:"center"}, apply:{backgroundColor:c.blue,padding:15,borderRadius:12,alignItems:"center"},
});
