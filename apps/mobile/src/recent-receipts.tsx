import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Decimal from "decimal.js";
import { GlassModal, glassStyles, useModalDismiss } from "./glass-ui";
import { theme as c } from "./theme";

export type RecentReceipt = {
  id: string;
  number: number;
  postedAt: string;
  supplier?: { name: string } | null;
  deliveredBy?: string | null;
  lines: { id: string; material: { name: string }; supplierName?: string | null; quantityKg: string }[];
};
const kg = (value: string) => new Decimal(value).toFixed().replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function RecentReceipts({ receipts, onClose }: { receipts: RecentReceipt[]; onClose: () => void }) {
  const { closing, dismiss } = useModalDismiss();
  const close = () => dismiss(onClose);
  return <GlassModal visible={!closing} animationType="slide" onRequestClose={close}>
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Последние приходы</Text>
          <Text style={styles.hint}>Последние 5 поступлений · время Ташкента</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть последние приходы" onPress={close} style={styles.close}>
          <Ionicons name="close" size={23} color={c.ink} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!receipts.length && <View style={styles.empty}>
          <Ionicons name="receipt-outline" size={36} color={c.muted} />
          <Text style={styles.title}>Приходов пока нет</Text>
          <Text style={styles.hint}>После приёмки сырья они появятся здесь.</Text>
        </View>}
        {receipts.map(receipt => <View key={receipt.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.supplier}>{receipt.supplier?.name || [...new Set(receipt.lines.map(line => line.supplierName).filter(Boolean))].join(" · ") || "Поставщик не указан"}</Text>
              <Text style={styles.hint}>Приход №{receipt.number}</Text>
              {!!receipt.deliveredBy && <Text style={styles.hint}>Привёз: {receipt.deliveredBy}</Text>}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.date}>{new Date(receipt.postedAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent" })}</Text>
              <Text style={styles.date}>{new Date(receipt.postedAt).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
          </View>
          <Text style={styles.hint}>Принято на склад</Text>
          {receipt.lines.map(line => <View key={line.id} style={styles.line}>
            <Text style={styles.material}>{line.material.name}</Text>
            <Text style={styles.weight}>{kg(line.quantityKg)} кг</Text>
          </View>)}
        </View>)}
      </ScrollView>
    </SafeAreaView>
  </GlassModal>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 18 },
  title: { color: c.ink, fontSize: 19, lineHeight: 26, fontWeight: "700" },
  hint: { color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  close: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.control, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingTop: 0, paddingBottom: 32, gap: 12 },
  card: { ...glassStyles.card, padding: 16 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  supplier: { color: c.ink, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  date: { color: c.ink, fontSize: 12, lineHeight: 19, fontWeight: "700" },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16, paddingVertical: 9 },
  material: { flex: 1, color: c.ink, fontSize: 14, lineHeight: 21 },
  weight: { color: c.ink, fontSize: 14, lineHeight: 21, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  empty: { alignItems: "center", gap: 12, padding: 30 },
});
