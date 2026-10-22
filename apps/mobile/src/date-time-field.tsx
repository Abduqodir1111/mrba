import { glassStyles } from "./glass-ui";
import React, {useState} from "react";
import {Keyboard, Platform, Pressable, StyleSheet, Text, View} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {Ionicons} from "@expo/vector-icons";

// Match the web field's Tashkent wall-clock value, even on phones in other zones.
function pickerDate(value: string) {
  const date = new Date(`${value}:00+05:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
function fieldValue(date: Date) {
  return new Date(date.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
export function DateTimeField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => pickerDate(value));
  const [androidMode, setAndroidMode] = useState<"date" | "time">("date");
  function begin() {
    Keyboard.dismiss();
    setDraft(pickerDate(value));
    setAndroidMode("date");
    setOpen(true);
  }
  const formatted = value ? `${value.slice(8,10)}.${value.slice(5,7)}.${value.slice(0,4)} · ${value.slice(11)}` : "Выберите дату и время";
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{text: formatted}} accessibilityState={{expanded: open}} onPress={begin} style={styles.field}>
      <Text style={[styles.value, !value && styles.placeholder]}>{formatted}</Text><Ionicons name="calendar-outline" size={20} color="#246BFD" />
    </Pressable>
    {open && <View style={styles.panel}>
      <Text style={styles.hint}>Время Ташкента</Text>
      <DateTimePicker value={draft} mode={Platform.OS === "ios" ? "datetime" : androidMode} display={Platform.OS === "ios" ? "inline" : "default"} timeZoneName="Asia/Tashkent" locale="ru-RU" themeVariant="light" accentColor="#246BFD" is24Hour
        onValueChange={(_event, date) => {
          setDraft(date);
          if (Platform.OS !== "ios") {
            if (androidMode === "date") setAndroidMode("time");
            else { onChange(fieldValue(date)); setOpen(false); }
          }
        }} onDismiss={Platform.OS === "android" ? () => setOpen(false) : undefined} style={styles.picker} />
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => {onChange(""); setOpen(false);}} style={styles.action}><Text style={styles.actionText}>Очистить</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.action}><Text style={styles.actionText}>Отмена</Text></Pressable>
        {Platform.OS === "ios" && <Pressable accessibilityRole="button" onPress={() => {onChange(fieldValue(draft)); setOpen(false);}} style={[styles.action, styles.done]}><Text style={styles.doneText}>Готово</Text></Pressable>}
      </View>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  field: {...glassStyles.control,flexDirection:"row", alignItems:"center", justifyContent:"space-between", gap:8, borderWidth:1, borderColor:"#E5E9EC", borderRadius:16, padding:13, minHeight:46, backgroundColor:"#fff"},
  value: {fontSize:14, color:"#182C3C", flexShrink:1}, placeholder: {color:"#7E8C96"},
  panel: {marginTop:8, borderWidth:1, borderColor:"#E5E9EC", borderRadius:12, padding:8, backgroundColor:"#fff"},
  hint: {fontSize:12, color:"#7E8C96", margin:4}, picker: {alignSelf:"stretch"},
  actions: {flexDirection:"row", justifyContent:"flex-end", flexWrap:"wrap", gap:4, marginTop:8},
  action: {paddingHorizontal:12, paddingVertical:10, borderRadius:10, minHeight:44}, actionText: {fontSize:14, color:"#246BFD"},
  done: {backgroundColor:"#246BFD"}, doneText: {fontSize:14, color:"#fff", fontWeight:"600"},
});
