import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Decimal from "decimal.js";
import { theme as c } from "./theme";

type Cost = { known: boolean; amounts: Record<string, string> };
const number = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(2).toFixed().replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const money = (value?: Cost | null) => !value?.known ? "Не определена" : Object.entries(value.amounts).map(([currency, amount]) => `${number(amount)} ${currency}`).join(" + ") || "0";
const scaled = (value: Cost | null, kg: Decimal): Cost | null => value && ({ known: value.known, amounts: Object.fromEntries(Object.entries(value.amounts).map(([currency, amount]) => [currency, new Decimal(amount).times(kg).toString()])) });

export function CompletedMeltDetails({ batch }: { batch: any }) {
  const loaded = batch.inputs.reduce((sum: Decimal, input: any) => sum.plus(input.quantityKg), new Decimal(0));
  const waste = batch.outputs.filter((output: any) => output.lot.item.kind === "WASTE");
  const products = batch.outputs.filter((output: any) => output.lot.item.kind === "PRODUCT");
  const wasteKg = waste.reduce((sum: Decimal, output: any) => sum.plus(output.quantityKg), new Decimal(0));
  const wastePercent = loaded.gt(0) ? `${number(wasteKg.div(loaded).times(100))} %` : "—";
  const productKg = products.reduce((sum: Decimal, output: any) => sum.plus(output.quantityKg), new Decimal(0));
  const currencies = [...new Set(batch.inputs.flatMap((input: any) => Object.keys(input.totalCost?.amounts ?? {})))] as string[];
  const tableMoney = (value?: Cost) => !value?.known ? "Не задана" : Object.entries(value.amounts).map(([currency, amount]) => `${number(amount)}${currencies.length > 1 ? ` ${currency}` : ""}`).join(" + ") || "0";
  const columnStyles = [styles.name, styles.weight, styles.price, styles.amount];
  const detail = (label: string, value: string, accent = false) => <View style={[styles.detail, accent && styles.accent]}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
  return <View style={styles.body}>
    <Text style={styles.heading}>Загруженное сырьё</Text>
    {currencies.length > 0 && <Text style={styles.note}>Цены и суммы: {currencies.join(" · ")}</Text>}
    <View style={styles.table}>
      <View style={[styles.row, styles.tableHeader]}>{["Сырьё", "Вес, кг", "За кг", "Сумма"].map((label, index) => <Text key={label} style={[styles.cell, styles.headerText, columnStyles[index], index > 0 && styles.numeric]}>{label}</Text>)}</View>
      {batch.inputs.map((input: any, index: number) => <View key={input.id} style={[styles.row, index % 2 === 1 && styles.alternate]}>
        <Text style={[styles.cell, styles.name]}>{input.lot.item.name}{input.lot.isCarryover ? "\nОстаток прошлой смены" : ""}</Text>
        <Text style={[styles.cell, styles.weight, styles.numeric]}>{number(input.quantityKg)}</Text>
        <Text style={[styles.cell, styles.price, styles.numeric]}>{tableMoney(input.unitCost)}</Text>
        <Text style={[styles.cell, styles.amount, styles.numeric]}>{tableMoney(input.totalCost)}</Text>
      </View>)}
    </View>
    {detail("Всего загружено", `${number(loaded)} кг`)}
    {detail("Общая стоимость", money(batch.totalCost), true)}
    {detail("Себестоимость за кг", money(batch.unitCost))}
    <Text style={styles.heading}>Результат плавки</Text>
    {products.map((output: any) => <View key={output.id}>{detail(output.lot.item.name, `${number(output.quantityKg)} кг`)}</View>)}
    {detail("Стоимость продукции", money(scaled(batch.unitCost, productKg)))}
    {detail(batch.carryoverRecovered ? "Возвращено на склад" : "Остаток следующей смены", `${number(batch.carryoverKg ?? 0)} кг`)}
    {detail("Стоимость остатка", money(batch.carryoverValue))}
    <View style={styles.waste}>
      {detail("Отходы от загрузки", `${number(wasteKg)} кг · ${wastePercent}`, true)}
      {waste.map((output: any) => <View key={output.id}>{detail(output.lot.item.name, `${number(output.quantityKg)} кг`)}</View>)}
      <Text style={styles.note}>Процент от всего загруженного веса, включая остаток предыдущей смены.</Text>
    </View>
    {detail("Безвозвратные потери", `${number(batch.differenceKg ?? 0)} кг`)}
  </View>;
}

const styles = StyleSheet.create({
  body: { gap: 4, marginTop: 8 },
  heading: { fontSize: 14, fontWeight: "700", color: c.ink, marginTop: 10, marginBottom: 6 },
  table: { borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: "hidden" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: c.line, alignItems: "stretch" },
  tableHeader: { backgroundColor: c.softBlue },
  alternate: { backgroundColor: c.bg },
  cell: { paddingHorizontal: 4, paddingVertical: 9, fontSize: 11, lineHeight: 16, color: c.ink, flexShrink: 1 },
  headerText: { fontWeight: "700" },
  name: { width: "26%" },
  weight: { width: "18%" },
  price: { width: "24%" },
  amount: { width: "32%" },
  numeric: { textAlign: "right", borderLeftWidth: 1, borderColor: c.line },
  detail: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 7 },
  label: { flex: 1, fontSize: 13, lineHeight: 19, color: c.muted },
  value: { flex: 1, fontSize: 13, lineHeight: 19, color: c.ink, fontWeight: "600", textAlign: "right" },
  accent: { backgroundColor: c.softBlue, borderRadius: 8, paddingHorizontal: 8 },
  waste: { borderTopWidth: 1, borderColor: c.line, marginTop: 8, paddingTop: 8 },
  note: { fontSize: 11, lineHeight: 16, color: c.muted, marginTop: 4, marginBottom: 8 },
});
