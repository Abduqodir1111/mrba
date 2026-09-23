import {
  KeyboardAwareScrollView,
  KeyboardProvider,
} from "react-native-keyboard-controller";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Decimal from "decimal.js";
import {
  api,
  mutate,
  all,
  saveDraft,
  resumeDraft,
  editDraft,
  cancelDraft,
} from "./api";
import { theme as c } from "./theme";
const fmt = (value: any) => {
  const n = new Decimal(value ?? 0);
  const [whole, fraction] = n
    .toFixed(Math.min(n.decimalPlaces(), 9))
    .split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ") +
    (fraction ? "," + fraction : "")
  );
};
const documentName = (v: string) =>
  (
    ({
      PURCHASE_RECEIPT: "Приход сырья",
      SUPPLIER_RETURN: "Возврат поставщику",
      TRANSFER: "Перемещение",
      PRODUCTION_ISSUE: "Загрузка плавки",
      PRODUCTION_RETURN: "Возврат из плавки",
      WASTE_REUSE: "Повторное использование отходов",
      PRODUCTION_COMPLETE: "Завершение плавки",
      WASTE_RECOVERY: "Переработка отходов",
      WASTE_DISPOSAL: "Списание отходов",
      WASTE_SALE: "Продажа отходов",
      SHIPMENT: "Отгрузка",
      REVERSAL: "Отмена документа",
      ADJUSTMENT: "Инвентаризация",
      BATCH_START: "Начало плавки",
      CUSTOMER_CREATE: "Создание клиента",
      MATERIAL_CREATE: "Создание материала",
      SUPPLIER_CREATE: "Создание поставщика",
      ITEM_CREATE: "Создание номенклатуры",
      OWNER_CREATE: "Создание владельца",
      CATALOG_EDIT: "Изменение справочника",
      CONTRACT_CREATE: "Создание договора",
      CONTRACT_AMEND: "Изменение договора",
      SHIPMENT_DEPART: "Выезд машины",
      SHIFT_CLOSE: "Закрытие смены",
      SHIFT_REOPEN: "Открытие смены",
      RESERVE: "Резерв",
      RESERVE_RELEASE: "Снятие резерва",
    }) as Record<string, string>
  )[v] ?? "Операция";
const status = (v: string) =>
  ({
    IN_PROGRESS: "В работе",
    COMPLETED: "Завершена",
    CANCELLED: "Отменена",
    REVERSED: "Отменён",
    POSTED: "Проведён",
    ACTIVE: "Действует",
    OPEN: "Открыта",
    CLOSED: "Закрыта",
  })[v] ?? v;
const date = (v: string) =>
  new Date(v).toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const Btn = ({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={[
      s.button,
      secondary && s.secondary,
      danger && {
        backgroundColor: "#FCECEC",
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
        justifyContent: "center",
      },
      disabled && { opacity: 0.4 },
    ]}
  >
    {danger && (
      <Ionicons name="close-circle-outline" size={22} color="#B84040" />
    )}
    <Text
      style={[
        s.buttonText,
        secondary && { color: c.blue },
        danger && { color: "#B84040" },
      ]}
    >
      {title}
    </Text>
  </Pressable>
);
const Card = ({ children }: { children: React.ReactNode }) => (
  <View style={s.card}>{children}</View>
);
const Title = ({ title, sub }: { title: string; sub?: string }) => (
  <View style={{ marginBottom: 20 }}>
    <Text style={s.eyebrow}>MRBA · КАТТАКУРГАН</Text>
    <Text style={s.title}>{title}</Text>
    {sub && <Text style={s.muted}>{sub}</Text>}
  </View>
);
const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={s.row}>
    <Text style={[s.muted, { flex: 1 }]}>{label}</Text>
    <Text style={[s.value, { flex: 1, textAlign: "right" }]}>{value}</Text>
  </View>
);
const Empty = ({ text }: { text: string }) => (
  <Card>
    <Ionicons name="layers-outline" size={28} color={c.blue} />
    <Text style={[s.text, { marginTop: 12 }]}>{text}</Text>
  </Card>
);
const stockKind = (r: any) => r.lot.stockKind ?? r.lot.item.kind;
const wasteDestination = (value?: string) =>
  value === "STORAGE"
    ? "На склад"
    : value === "SALE"
      ? "На продажу"
      : "Назначение не указано";
const wasteChoices = [
  { id: "STORAGE", name: "На склад" },
  { id: "SALE", name: "На продажу" },
];
type Option = { id: string; name: string };
type Field = {
  key: string;
  label: string;
  options?: Option[];
  number?: boolean;
  secure?: boolean;
  weight?: boolean;
  required?: boolean;
  value?: string;
};
type Form = {
  title: string;
  subtitle?: string;
  fields: Field[];
  repeat?: { label: string; fields: Field[]; minimum?: number };
  wasteOptions?: Option[];
  loadedWeightKg?: string;
  allowHandover?: boolean;
  loadingSummary?: boolean;
  saleStock?: Record<string, string>;
  allowDraft?: boolean;
  submit: (values: Record<string, string>, send: typeof mutate) => Promise<any>;
};
const actionLabels: Record<string, string> = {
  "Продажа продукции": "Продать",
  "Загрузка плавки": "Загрузить",
  "Результат плавки": "Завершить плавку",
  "Новая плавка": "Начать плавку",
  "Приход сырья": "Принять сырьё",
  "Новая продукция": "Добавить продукцию",
  "Новый вид отходов": "Добавить вид отходов",
  "Возврат поставщику": "Вернуть поставщику",
  "Выезд машины": "Отметить выезд",
  "Закрытие договора": "Закрыть договор",
  Инвентаризация: "Сохранить остаток",
  "Новый владелец": "Добавить владельца",
  "Новый клиент": "Добавить клиента",
  Оборудование: "Добавить котёл",
  "Отзыв доступа": "Завершить подключение",
  "Отмена документа": "Отменить документ",
  "Отмена плавки": "Отменить плавку",
  "Переместить партию": "Переместить",
  "Переместить сырьё": "Переместить",
  "Переработка отходов": "Переработать",
  "Повторное открытие": "Открыть смену",
  "Продажа отходов": "Оформить продажу",
  "Резерв партии": "Зарезервировать",
  "Складская зона": "Добавить склад",
  "Снятие резерва": "Снять резерв",
  "Списание отходов": "Списать отходы",
  "Новый договор": "Создать договор",
  "Отгрузка по договору": "Оформить отгрузку",
  "Условия договора": "Сохранить условия",
  "Выберите запись": "Продолжить",
  "Фильтры отчёта": "Применить фильтры",
  "Изменить черновик": "Сохранить черновик",
};
function Editor({
  form,
  close,
  saved,
  failed,
}: {
  form: Form;
  close: () => void;
  saved: () => void;
  failed: () => void;
}) {
  const [handover, setHandover] = useState(false);
  const actionLabel = handover
    ? "Передать следующей смене"
    : (actionLabels[form.title] ?? "Сохранить изменения");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      form.fields.map((f) => [
        f.key,
        f.value ??
          (f.key === "productId" && f.options?.length === 1
            ? f.options[0].id
            : f.key === "reason"
              ? `Действие владельца: ${form.title}`
              : ""),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rowCount, setRowCount] = useState(form.repeat?.minimum ?? 1);
  const repeated = form.repeat
    ? Array.from({ length: rowCount }, (_, i) =>
        form.repeat!.fields.map((f) => ({
          ...f,
          key: `row_${i}_${f.key}`,
          label: `${i + 1}. ${f.label}`,
        })),
      ).flat()
    : [];
  const fields = [...form.fields, ...repeated].filter(
    (f) => !["reason", "notes"].includes(f.key.split(".").at(-1) ?? ""),
  );
  const [weightUnit, setWeightUnit] = useState<"kg" | "t">("kg");
  const enteredWeight = (value: string | undefined): Decimal | null => {
    if (!value?.trim()) return new Decimal(0);
    try {
      const number = new Decimal(value.trim().replace(",", "."));
      return number.isFinite() && number.gte(0) ? number : null;
    } catch {
      return null;
    }
  };
  const loadedKg = enteredWeight(form.loadedWeightKg);
  const wasteTotal = (form.wasteOptions ?? []).reduce<Decimal | null>(
    (total, option) => {
      const weight = enteredWeight(values[`waste_${option.id}`]);
      return total && weight ? total.plus(weight) : null;
    },
    new Decimal(0),
  );
  const finishedProductKg = enteredWeight(values.productQuantityKg)?.times(
    weightUnit === "t" ? 1000 : 1,
  );
  const actualLossKg =
    loadedKg && wasteTotal && finishedProductKg
      ? loadedKg.minus(wasteTotal).minus(finishedProductKg)
      : null;
  const estimatedLossKg =
    loadedKg?.div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP) ?? null;
  const lossKg = handover ? estimatedLossKg : actualLossKg;
  const carryoverKg =
    actualLossKg && estimatedLossKg
      ? actualLossKg.minus(estimatedLossKg)
      : null;
  const exceedsLoadedWeight = actualLossKg?.lt(0) ?? false;
  const invalidCompletionWeight =
    !!form.allowHandover &&
    (!actualLossKg ||
      exceedsLoadedWeight ||
      (handover && (!carryoverKg || carryoverKg.lte(0))));
  const wastePercent = (weight: Decimal | null) =>
    weight && loadedKg?.gt(0)
      ? `${weight.div(loadedKg).times(100).toFixed(2).replace(".", ",")}%`
      : "—";
  const saleAvailable = enteredWeight(form.saleStock?.[values.itemId]);
  const saleQuantity = enteredWeight(values.quantityKg);
  const salePrice = enteredWeight(values.unitPricePerKg);
  const invalidSale =
    !!form.saleStock &&
    (!values.customerName?.trim() ||
      !values.itemId ||
      !saleQuantity?.gt(0) ||
      !saleQuantity.isInteger() ||
      !salePrice?.gt(0) ||
      !saleAvailable ||
      saleQuantity.gt(saleAvailable));
  const save = async (draft = false) => {
    setError("");
    try {
      if (invalidSale)
        throw Error(
          "Проверьте покупателя, количество и цену. Продажа не должна превышать доступный остаток.",
        );
      const v: Record<string, string> = { ...values };
      if (form.allowHandover) v._handover = String(handover);
      if (handover && !v.productQuantityKg?.trim()) v.productQuantityKg = "0";
      for (const f of fields) {
        if (f.key === "productId") {
          if (!f.options?.length)
            throw Error(
              "Сначала добавьте готовую продукцию: «Ещё» → «+ Продукция».",
            );
          if (!v[f.key] && f.options.length === 1) v[f.key] = f.options[0].id;
          if (!v[f.key])
            throw Error("Выберите название готовой продукции вверху формы.");
        }
        if (f.required !== false && !v[f.key]?.trim())
          throw Error(`Заполните «${f.label}»`);
        if (f.weight && v[f.key]) {
          const n = new Decimal(v[f.key].replace(",", ".")).times(
            weightUnit === "t" ? 1000 : 1,
          );
          if (n.lt(0) || !n.isInteger())
            throw Error("Вес должен соответствовать целому числу килограммов");
          v[f.key] = n.toFixed(0);
        } else if (f.number) v[f.key] = v[f.key]?.replace(",", ".");
      }
      if (form.wasteOptions) {
        const waste = form.wasteOptions.flatMap(({ id, name }) => {
          const raw = values[`waste_${id}`]?.trim().replace(",", ".");
          if (!raw) return [];
          const kg = new Decimal(raw);
          if (!kg.isFinite() || !kg.isInteger() || kg.lt(0))
            throw Error(
              `Вес отходов «${name}» должен быть целым неотрицательным числом кг`,
            );
          return kg.isZero() ? [] : [{ itemId: id, quantityKg: kg.toFixed(0) }];
        });
        if (!handover && !waste.length)
          throw Error("Укажите вес хотя бы одного вида отходов");
        v._waste = JSON.stringify(waste);
      }
      if (form.allowHandover) {
        if (handover && (!carryoverKg || carryoverKg.lte(0)))
          throw Error(
            "После вычета продукции, отходов и 1% потерь должен остаться металл. Если котёл пуст — выключите пересменку.",
          );
        if (!handover && (!finishedProductKg || finishedProductKg.lte(0)))
          throw Error("Укажите вес выпущенной готовой продукции");
        if (!actualLossKg || actualLossKg.lt(0))
          throw Error("Продукция и отходы превышают загруженный вес");
      }
      setBusy(true);
      if (form.repeat) v._rows = String(rowCount);
      await form.submit(v, draft ? saveDraft : mutate);
      saved();
    } catch (e) {
      setError((e as Error).message);
      failed();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => !busy && close()}
    >
      <KeyboardProvider>
        <SafeAreaView style={s.modal}>
          <View style={{ flex: 1 }}>
            <View style={s.modalHead}>
              <Text style={s.section}>{form.title}</Text>
              <Pressable
                accessibilityLabel="Закрыть"
                disabled={busy}
                onPress={close}
              >
                <Ionicons name="close-circle" color={c.muted} size={30} />
              </Pressable>
            </View>
            <KeyboardAwareScrollView
              bottomOffset={24}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 22, paddingBottom: 40 }}
            >
              {form.subtitle && (
                <Text style={[s.muted, { marginBottom: 20 }]}>
                  {form.subtitle}
                </Text>
              )}
              {fields.some((f) => f.weight) && (
                <View style={s.chips}>
                  {(["kg", "t"] as const).map((u) => (
                    <Pressable
                      key={u}
                      onPress={() => setWeightUnit(u)}
                      style={[s.chip, weightUnit === u && s.chipOn]}
                    >
                      <Text
                        style={{ color: weightUnit === u ? c.blue : c.muted }}
                      >
                        {u === "kg" ? "Целые кг" : "Тонны"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {fields.map((f) => (
                <View key={f.key} style={{ marginBottom: 20 }}>
                  <Text style={s.label}>
                    {f.label}
                    {f.weight ? ` · ${weightUnit === "kg" ? "кг" : "т"}` : ""}
                  </Text>
                  {f.options ? (
                    <View style={s.options}>
                      {!f.options.length ? (
                        <Text style={s.muted}>
                          {f.key === "productId"
                            ? "Нет готовой продукции. Добавьте её название: «Ещё» → «+ Продукция»."
                            : "Нет подходящих записей. Сначала добавьте их в справочник."}
                        </Text>
                      ) : (
                        f.options.map((o) => (
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{
                              checked: values[f.key] === o.id,
                            }}
                            key={o.id}
                            onPress={() =>
                              setValues({ ...values, [f.key]: o.id })
                            }
                            style={[
                              s.option,
                              values[f.key] === o.id && s.optionOn,
                            ]}
                          >
                            <Text
                              style={[
                                s.text,
                                { flex: 1 },
                                values[f.key] === o.id && { color: c.blue },
                              ]}
                            >
                              {o.name}
                            </Text>
                            {values[f.key] === o.id && (
                              <Ionicons
                                name="checkmark-circle"
                                size={20}
                                color={c.blue}
                              />
                            )}
                          </Pressable>
                        ))
                      )}
                    </View>
                  ) : (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <TextInput
                          accessibilityLabel={f.label}
                          editable={!busy}
                          secureTextEntry={f.secure}
                          autoCapitalize={f.secure ? "none" : "sentences"}
                          value={values[f.key]}
                          onChangeText={(v) =>
                            setValues({ ...values, [f.key]: v })
                          }
                          style={s.input}
                          keyboardType={
                            f.weight || f.number ? "decimal-pad" : "default"
                          }
                          placeholder={f.weight ? "0" : f.label}
                          placeholderTextColor={c.muted}
                        />
                      </View>
                      {form.allowHandover && f.key === "productQuantityKg" && (
                        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                          <Text style={s.muted}>
                            Загружено: {loadedKg ? `${fmt(loadedKg)} кг` : "—"}
                          </Text>
                          <Text
                            style={[
                              s.label,
                              { marginBottom: 0 },
                              exceedsLoadedWeight && { color: "#B84040" },
                            ]}
                            accessibilityLiveRegion="polite"
                          >
                            {actualLossKg?.lt(0) ? "Превышение" : "Остаток"}:{" "}
                            {actualLossKg
                              ? `${fmt(actualLossKg.abs())} кг`
                              : "—"}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              ))}
              {form.saleStock && (
                <View style={{ marginBottom: 20, gap: 8 }}>
                  <Row
                    label="Доступно на складе"
                    value={
                      values.itemId && saleAvailable
                        ? `${fmt(saleAvailable)} кг`
                        : "—"
                    }
                  />
                  <Row
                    label="Сумма продажи"
                    value={
                      saleQuantity && salePrice
                        ? `${fmt(saleQuantity.times(salePrice))} ${values.currency}`
                        : "—"
                    }
                  />
                  {saleQuantity &&
                    saleAvailable &&
                    saleQuantity.gt(saleAvailable) && (
                      <Text style={s.error}>
                        Количество превышает доступный остаток на{" "}
                        {fmt(saleQuantity.minus(saleAvailable))} кг.
                      </Text>
                    )}
                </View>
              )}
              {form.loadingSummary && (
                <Row
                  label="Всего к загрузке"
                  value={(() => {
                    const total = fields.reduce<Decimal | null>((sum, f) => {
                      const quantity = enteredWeight(values[f.key]);
                      return sum && quantity ? sum.plus(quantity) : null;
                    }, new Decimal(0));
                    return total
                      ? `${fmt(total.times(weightUnit === "t" ? 1000 : 1))} кг`
                      : "—";
                  })()}
                />
              )}
              {form.wasteOptions && (
                <View style={{ marginBottom: 20 }}>
                  {form.allowHandover && (
                    <View style={{ marginBottom: 20, gap: 8 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <Text style={[s.label, { flex: 1 }]}>
                          Пересменка — в котле остался металл
                        </Text>
                        <Switch
                          accessibilityLabel="Пересменка — в котле остался металл"
                          value={handover}
                          disabled={busy}
                          onValueChange={setHandover}
                          trackColor={{ true: c.blue }}
                        />
                      </View>
                      <Text style={s.muted}>
                        {handover
                          ? "Потери: 1% от веса этого этапа, включая остаток предыдущей смены, с округлением до целого кг. Остаток перейдёт следующей смене в этом котле. Если продукцию ещё не извлекли, укажите 0 кг."
                          : "Котёл пуст: весь недостающий вес будет учтён как безвозвратные потери."}
                      </Text>
                    </View>
                  )}
                  <Text style={s.label}>Виды отходов</Text>
                  <Text style={[s.muted, { marginBottom: 12 }]}>
                    Укажите полученный вес. Если отходов этого вида нет,
                    оставьте поле пустым или укажите 0.
                  </Text>
                  {!form.wasteOptions.length && (
                    <Text style={s.muted}>
                      Сначала добавьте виды отходов во вкладке «Ещё».
                    </Text>
                  )}
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      alignItems: "stretch",
                      gap: 12,
                    }}
                  >
                    {form.wasteOptions.map(({ id, name }) => (
                      <View
                        key={id}
                        style={{ flexGrow: 1, flexBasis: 120, minWidth: 120 }}
                      >
                        <Text
                          style={[
                            s.label,
                            {
                              fontSize: 12,
                              flex: 1,
                              textAlign: "center",
                              marginBottom: 8,
                            },
                          ]}
                        >
                          {name}
                        </Text>
                        <TextInput
                          accessibilityLabel={`Вес отходов ${name}, кг`}
                          editable={!busy}
                          keyboardType="number-pad"
                          style={[
                            s.input,
                            {
                              width: "100%",
                              minWidth: 0,
                              paddingHorizontal: 4,
                              fontSize: 14,
                              textAlign: "center",
                            },
                          ]}
                          placeholder="кг"
                          placeholderTextColor={c.muted}
                          value={values[`waste_${id}`] ?? ""}
                          onChangeText={(value) =>
                            setValues((previous) => ({
                              ...previous,
                              [`waste_${id}`]: value,
                            }))
                          }
                        />
                        <Text
                          style={[
                            s.muted,
                            { textAlign: "center", marginTop: 6 },
                          ]}
                        >
                          {wastePercent(enteredWeight(values[`waste_${id}`]))}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ marginTop: 16, gap: 8 }}>
                    <Row
                      label="Загружено в котёл"
                      value={loadedKg ? `${fmt(loadedKg)} кг` : "—"}
                    />
                    <Row
                      label="Всего отходов"
                      value={wasteTotal ? `${fmt(wasteTotal)} кг` : "—"}
                    />
                    <Row
                      label="От загруженного сырья"
                      value={wastePercent(wasteTotal)}
                    />
                    <Row
                      label="Безвозвратные потери"
                      value={
                        lossKg && lossKg.gte(0)
                          ? `${fmt(lossKg)} кг · ${wastePercent(lossKg)}`
                          : "—"
                      }
                    />
                    {handover && (
                      <Row
                        label="Остаток следующей смене"
                        value={carryoverKg ? `${fmt(carryoverKg)} кг` : "—"}
                      />
                    )}
                    {handover && carryoverKg?.lte(0) && (
                      <Text style={s.error}>
                        Нет остатка для передачи. Проверьте вес или выключите
                        пересменку.
                      </Text>
                    )}
                    {actualLossKg?.lt(0) && (
                      <Text style={s.error}>
                        Продукция и отходы превышают загруженный вес.
                      </Text>
                    )}
                    {!loadedKg?.gt(0) && (
                      <Text style={s.muted}>
                        Нет загруженного сырья для расчёта процентов.
                      </Text>
                    )}
                  </View>
                </View>
              )}
              {form.repeat && (
                <View>
                  <Btn
                    secondary
                    disabled={busy || rowCount >= 50}
                    title={`+ ${form.repeat.label}`}
                    onPress={() => setRowCount((n) => n + 1)}
                  />
                  {rowCount > (form.repeat.minimum ?? 1) && (
                    <Btn
                      secondary
                      disabled={busy}
                      title="Убрать последнюю строку"
                      onPress={() => setRowCount((n) => n - 1)}
                    />
                  )}
                </View>
              )}
              {!!error && <Text style={s.error}>{error}</Text>}
              <Btn
                title={busy ? "Сохранение…" : actionLabel}
                disabled={busy || invalidCompletionWeight || invalidSale}
                onPress={() =>
                  Alert.alert(
                    `${actionLabel}?`,
                    "После подтверждения операция будет сохранена на сервере.",
                    [
                      { text: "Назад", style: "cancel" },
                      { text: actionLabel, onPress: () => void save() },
                    ],
                  )
                }
              />
            </KeyboardAwareScrollView>
          </View>
        </SafeAreaView>
      </KeyboardProvider>
    </Modal>
  );
}
const formRows = (v: Record<string, string>) =>
  Array.from({ length: Number(v._rows) }, (_, i) =>
    Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k.startsWith(`row_${i}_`))
        .map(([k, value]) => [k.slice(`row_${i}_`.length), value]),
    ),
  );
const weight = (key = "quantityKg", label = "Вес"): Field => ({
  key,
  label,
  weight: true,
});
const reason: Field = { key: "reason", label: "Причина / комментарий" };
const opt = (key: string, label: string, rows: Option[]): Field => ({
  key,
  label,
  options: rows,
});
const currencies: Field = opt("currency", "Валюта", [
  { id: "UZS", name: "Узбекские сумы · UZS" },
  { id: "USD", name: "Доллары США · USD" },
]);
const options = (
  rows: any[],
  label: (r: any) => string = (r) => r.name,
): Option[] => rows.map((r) => ({ id: r.id, name: label(r) }));
const itemName = (r: any) =>
  `${r.lot.item.name} · ${fmt(r.onHandKg)} кг · ${r.location.name} · ${r.lotId.slice(0, 6)}`;
export function Workspace({
  section,
  refreshKey = 0,
  onChanged,
}: {
  section: "production" | "inventory" | "sales" | "management";
  refreshKey?: number;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Record<string, any[]>>({});
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("");
  const [batchFilter, setBatchFilter] = useState<"IN_PROGRESS" | "COMPLETED">(
    "IN_PROGRESS",
  );
  const [salesView, setSalesView] = useState<"sale" | "report">("sale");
  const [stockWarehouse, setStockWarehouse] = useState("Основной склад");
  const [stockDetails, setStockDetails] = useState<string | null>(null);
  const [massUnit, setMassUnit] = useState<"kg" | "t">("kg");
  const mass = (value: any) =>
    `${fmt(new Decimal(value).div(massUnit === "t" ? 1000 : 1))} ${massUnit === "t" ? "т" : "кг"}`;
  const load = async () => {
    setBusy(true);
    try {
      const routes =
        section === "production"
          ? ["items", "equipment", "batches", "stock", "locations", "shifts"]
          : section === "sales"
            ? ["items", "customers", "contracts", "shipments", "stock"]
            : section === "inventory"
              ? ["stock", "locations", "reservations", "items", "suppliers"]
              : [
                  "items",
                  "equipment",
                  "locations",
                  "documents",
                  "audit",
                  "drafts",
                  "users",
                  "sessions",
                  "suppliers",
                  "materials",
                  "customers",
                ];
      const results = await Promise.all(
        routes.map(
          async (route) =>
            [
              route,
              [
                "items",
                "equipment",
                "locations",
                "customers",
                "suppliers",
                "stock",
              ].includes(route)
                ? await all("/" + route)
                : await api("/" + route),
            ] as const,
        ),
      );
      setData(
        Object.fromEntries(
          results.map(([k, v]) => [k, Array.isArray(v) ? v : v.items]),
        ),
      );
      setCursors(
        Object.fromEntries(
          results.map(([k, v]) => [k, Array.isArray(v) ? null : v.nextCursor]),
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [section, refreshKey]);
  const rows = (key: string) => data[key] ?? [];
  const filtered = (key: string) =>
    rows(key).filter((r) =>
      JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
    );
  const groupedStock = Array.from(
    rows("stock")
      .reduce((groups: Map<string, any>, r: any) => {
        const key = `${r.lot.itemId}:${r.locationId}:${stockKind(r)}`;
        const group = groups.get(key) ?? {
          ...r,
          key,
          onHandKg: new Decimal(0),
          reservedKg: new Decimal(0),
          entries: [],
        };
        group.onHandKg = group.onHandKg.plus(r.onHandKg);
        group.reservedKg = group.reservedKg.plus(r.reservedKg);
        group.entries.push(r);
        groups.set(key, group);
        return groups;
      }, new Map<string, any>())
      .values(),
  ) as any[];
  const loadingStock = Array.from(
    rows("stock")
      .filter(
        (r) =>
          r.location.name === "Основной склад" && r.lot.item.kind !== "PRODUCT",
      )
      .reduce((groups: Map<string, any>, r: any) => {
        const key = `${r.lot.itemId}:${r.locationId}`;
        const current = groups.get(key) ?? {
          id: key,
          name: r.lot.item.name,
          quantity: new Decimal(0),
        };
        current.quantity = current.quantity.plus(
          new Decimal(r.onHandKg).minus(r.reservedKg),
        );
        groups.set(key, current);
        return groups;
      }, new Map<string, any>())
      .values(),
  ).filter((r: any) => r.quantity.gt(0));
  const storage = rows("locations").filter((l) => l.kind === "STORAGE");
  const setup = (
    title: string,
    path: string,
    fields: Field[],
    build: (v: Record<string, string>) => any = (v) => v,
    subtitle?: string,
  ) =>
    setForm({
      title,
      fields,
      subtitle,
      allowDraft: !path.startsWith("/users") && !path.startsWith("/sessions"),
      submit: (v, send) => send(path, build(v)),
    });
  const simple = (title: string, path: string, body: any) =>
    Alert.alert(title, "Подтвердите действие.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Подтвердить",
        onPress: () => {
          void (async () => {
            try {
              await mutate(path, body);
              await load();
              onChanged();
            } catch (e) {
              Alert.alert("Не удалось выполнить", (e as Error).message);
            }
          })();
        },
      },
    ]);
  const saleProducts = new Map<string, { name: string; quantity: Decimal }>();
  for (const row of rows("stock")) {
    if (
      stockKind(row) !== "PRODUCT" ||
      row.lot.item.kind !== "PRODUCT" ||
      !row.lot.item.isActive ||
      row.lot.isCarryover ||
      row.location.kind !== "STORAGE" ||
      row.location.name !== "Склад для продажи"
    )
      continue;
    const available = new Decimal(row.onHandKg).minus(row.reservedKg);
    if (available.lte(0)) continue;
    const previous = saleProducts.get(row.lot.itemId);
    saleProducts.set(row.lot.itemId, {
      name: row.lot.item.name,
      quantity: (previous?.quantity ?? new Decimal(0)).plus(available),
    });
  }
  const transfer = (r: any, destination?: string) =>
    setup(
      "Переместить партию",
      "/inventory/transfer",
      [
        weight(),
        opt(
          "destinationId",
          "Куда",
          options(
            rows("locations").filter(
              (l) =>
                l.id !== r.locationId &&
                (!l.batch || l.batch.status === "IN_PROGRESS"),
            ),
          ),
        ),
        reason,
      ],
      (v) => ({ ...v, lotId: r.lotId, locationId: r.locationId }),
      `Доступно ${fmt(new Decimal(r.onHandKg).minus(r.reservedKg))} кг. ${r.lot.item.name}`,
    );
  return (
    <View>
      {section === "production" && (
        <>
          <View style={s.productionTabs}>
            {(
              [
                ["IN_PROGRESS", "В работе"],
                ["COMPLETED", "Завершено"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: batchFilter === value }}
                onPress={() => setBatchFilter(value)}
                style={({ pressed }) => [
                  s.productionTab,
                  batchFilter === value && s.productionTabActive,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text
                  style={[
                    s.productionTabText,
                    { color: batchFilter === value ? c.white : c.muted },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {busy && <ActivityIndicator color={c.blue} />}
      {!!error && <Text style={s.error}>{error}</Text>}
      {section !== "production" &&
        !(section === "sales" && salesView === "report") && (
          <View style={s.row}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск"
              placeholderTextColor={c.muted}
            />
            <Pressable
              accessibilityLabel="Обновить раздел"
              onPress={() => void load()}
              style={{ padding: 12 }}
            >
              <Ionicons name="refresh" size={22} color={c.blue} />
            </Pressable>
          </View>
        )}
      {section === "production" && (
        <>
          <Btn
            title="+  Начать плавку"
            disabled={busy || !!error}
            onPress={() =>
              setup(
                "Новая плавка",
                "/batches",
                [
                  opt(
                    "equipmentId",
                    "Котёл / оборудование",
                    options(rows("equipment").filter((e) => e.isActive)),
                  ),
                  { key: "notes", label: "Комментарий", required: false },
                ],
                undefined,
                "Смена и её дата определяются по времени Ташкента. Ночная смена относится к дате начала.",
              )
            }
          />
          {!rows("equipment").length && (
            <Btn
              title="Добавить котёл"
              secondary
              onPress={() =>
                setup("Оборудование", "/equipment", [
                  { key: "name", label: "Название" },
                  opt("direction", "Направление", [
                    { id: "COPPER", name: "Медь" },
                    { id: "BRASS", name: "Латунь" },
                  ]),
                ])
              }
            />
          )}
          {!rows("batches").some((b) => b.status === batchFilter) && !busy && (
            <Empty
              text={
                batchFilter === "IN_PROGRESS"
                  ? "Нет плавок в работе."
                  : "Завершённых плавок пока нет."
              }
            />
          )}
          {rows("batches")
            .filter((b) => b.status === batchFilter)
            .map((b) => (
              <Card key={b.id}>
                <View style={s.row}>
                  <Text style={s.section}>{b.equipment.name}</Text>
                  <Text style={s.badge}>{status(b.status)}</Text>
                </View>
                <Text style={s.muted}>{b.number}</Text>
                <Row label={b.shift.name} value={b.shift.businessDate} />
                <Row label="Начало" value={date(b.startedAt)} />
                {b.previousBatch && (
                  <Row
                    label="Остаток предыдущей смены"
                    value={`${fmt(b.previousBatch.carryoverKg)} кг`}
                  />
                )}
                {new Decimal(b.carryoverKg ?? 0).gt(0) && (
                  <Row
                    label="Передано следующей смене"
                    value={`${fmt(b.carryoverKg)} кг`}
                  />
                )}
                {b.status === "IN_PROGRESS" && (
                  <>
                    <Row
                      label="Загружено"
                      value={`${fmt(
                        rows("stock")
                          .filter((r) => r.locationId === b.wipLocationId)
                          .reduce((a, r) => a.plus(r.onHandKg), new Decimal(0)),
                      )} кг`}
                    />
                    {groupedStock
                      .filter((r) => r.locationId === b.wipLocationId)
                      .map((r) => (
                        <Row
                          key={r.key}
                          label={r.lot.item.name}
                          value={`${fmt(r.onHandKg)} кг`}
                        />
                      ))}
                    <Btn
                      secondary
                      title="Загрузить сырьё / отходы"
                      onPress={() =>
                        setForm({
                          title: "Загрузка плавки",
                          loadingSummary: true,
                          allowDraft: true,
                          subtitle:
                            "Укажите вес каждого сырья. Пустое поле или 0 — не загружать.",
                          fields: loadingStock.map((r: any) => ({
                            ...weight(
                              `load_${r.id.split(":")[0]}`,
                              `${r.name} · доступно ${fmt(r.quantity)} кг`,
                            ),
                            required: false,
                          })),
                          submit: (v, send) => {
                            const lines = loadingStock.flatMap((r: any) => {
                              const itemId = r.id.split(":")[0];
                              const quantity = new Decimal(
                                v[`load_${itemId}`] || "0",
                              );
                              if (quantity.isZero()) return [];
                              if (quantity.gt(r.quantity))
                                throw Error(
                                  `Недостаточно сырья «${r.name}»: доступно ${fmt(r.quantity)} кг`,
                                );
                              return [
                                { itemId, quantityKg: quantity.toFixed(0) },
                              ];
                            });
                            if (!lines.length)
                              throw Error("Укажите вес хотя бы одного сырья");
                            return send(`/batches/${b.id}/load`, { lines });
                          },
                        })
                      }
                    />
                    <Btn
                      title="Завершить плавку"
                      onPress={() =>
                        setForm({
                          title: "Результат плавки",
                          allowHandover: true,
                          loadedWeightKg: rows("stock")
                            .filter((r) => r.locationId === b.wipLocationId)
                            .reduce(
                              (sum, r) => sum.plus(r.onHandKg),
                              new Decimal(0),
                            )
                            .toFixed(0),
                          fields: [
                            opt(
                              "productId",
                              "Готовая продукция",
                              options(
                                rows("items").filter(
                                  (i) => i.kind === "PRODUCT" && i.isActive,
                                ),
                              ),
                            ),
                            weight(
                              "productQuantityKg",
                              "Вес готовой продукции",
                            ),
                          ],
                          wasteOptions: options(
                            rows("items").filter(
                              (i) => i.kind === "WASTE" && i.isActive,
                            ),
                          ),
                          allowDraft: true,
                          submit: (v, send) => {
                            const mainStorage = storage.find(
                              (l) => l.name === "Основной склад",
                            );
                            if (!mainStorage)
                              throw Error(
                                "Основной склад не найден. Обновите раздел.",
                              );
                            return send(`/batches/${b.id}/complete`, {
                              version: b.version,
                              locationId: mainStorage.id,
                              handover: v._handover === "true",
                              ...(v._handover === "true"
                                ? { carryoverItemId: v.productId }
                                : {}),
                              outputs: [
                                ...(new Decimal(v.productQuantityKg).gt(0)
                                  ? [
                                      {
                                        itemId: v.productId,
                                        quantityKg: v.productQuantityKg,
                                      },
                                    ]
                                  : []),
                                ...JSON.parse(v._waste),
                              ],
                            });
                          },
                        })
                      }
                    />
                    <Btn
                      title="Отменить плавку"
                      danger
                      onPress={() =>
                        simple(
                          "Отменить плавку и вернуть загруженное сырьё на основной склад?",
                          `/batches/${b.id}/cancel`,
                          { reason: "Отмена плавки владельцем" },
                        )
                      }
                    />
                  </>
                )}
                {b.status === "COMPLETED" && (
                  <Row
                    label="Безвозвратные потери"
                    value={`${fmt(b.differenceKg ?? "0")} кг`}
                  />
                )}
                {b.status === "COMPLETED" &&
                  b.outputs.map((o: any) => (
                    <Row
                      key={o.id}
                      label={o.lot.item.name}
                      value={`${fmt(o.quantityKg)} кг`}
                    />
                  ))}
              </Card>
            ))}
          <Text style={s.section}>Смены</Text>
          {filtered("shifts").map((sh) => (
            <Card key={sh.id}>
              <Row label={sh.name} value={sh.businessDate} />
              <Row label="Статус" value={status(sh.status)} />
              <Btn
                secondary
                title={
                  sh.status === "OPEN" ? "Закрыть смену" : "Открыть повторно"
                }
                onPress={() =>
                  sh.status === "OPEN"
                    ? simple("Закрыть смену?", `/shifts/${sh.id}/close`, {
                        version: sh.version,
                      })
                    : setup("Повторное открытие", `/shifts/${sh.id}/reopen`, [
                        reason,
                      ])
                }
              />
            </Card>
          ))}
        </>
      )}
      {section === "inventory" && (
        <>
          <View style={s.chips}>
            {["Основной склад", "Склад для продажи"].map((name) => (
              <Pressable
                key={name}
                accessibilityRole="tab"
                accessibilityState={{ selected: stockWarehouse === name }}
                onPress={() => setStockWarehouse(name)}
                style={[s.chip, stockWarehouse === name && s.chipOn]}
              >
                <Text
                  style={{ color: stockWarehouse === name ? c.blue : c.muted }}
                >
                  {name}
                </Text>
              </Pressable>
            ))}
          </View>

          <Btn
            secondary
            title="Принять несколько позиций"
            onPress={() =>
              setForm({
                title: "Приход сырья",
                allowDraft: true,
                fields: [
                  currencies,
                  { key: "notes", label: "Комментарий", required: false },
                ],
                repeat: {
                  label: "Добавить материал",
                  fields: [
                    opt(
                      "materialId",
                      "Материал",
                      options(
                        rows("items").filter(
                          (i) => i.kind === "MATERIAL" && i.isActive,
                        ),
                      ),
                    ),
                    weight("quantity", "Вес"),
                    {
                      key: "unitPricePerKg",
                      label: "Цена за кг",
                      number: true,
                    },
                  ],
                },
                submit: (v, send) =>
                  send("/purchase-receipts", {
                    currency: v.currency,
                    notes: v.notes,
                    lines: formRows(v).map((l) => ({ ...l, unit: "kg" })),
                  }),
              })
            }
          />
          <View style={s.chips}>
            {(["kg", "t"] as const).map((u) => (
              <Pressable
                key={u}
                style={[s.chip, massUnit === u && s.chipOn]}
                onPress={() => setMassUnit(u)}
              >
                <Text style={s.text}>
                  {u === "kg" ? "Килограммы" : "Тонны"}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={s.chips}>
            {[
              ["", "Все"],
              ["MATERIAL", "Сырьё"],
              ["PRODUCT", "Продукция"],
              ["WASTE", "Отходы"],
            ].map(([k, n]) => (
              <Pressable
                key={k}
                onPress={() => setView(k)}
                style={[s.chip, view === k && s.chipOn]}
              >
                <Text style={{ color: view === k ? c.blue : c.muted }}>
                  {n}
                </Text>
              </Pressable>
            ))}
          </View>
          {groupedStock
            .filter(
              (r) =>
                r.location.name === stockWarehouse &&
                (!view || stockKind(r) === view) &&
                r.lot.item.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((group) =>
              group.location.name === "Склад для продажи" ? (
                <View
                  key={group.key}
                  style={{
                    backgroundColor: c.white,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: c.line,
                    padding: 14,
                    marginBottom: 10,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        backgroundColor: c.softBlue,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name={
                          stockKind(group) === "WASTE"
                            ? "leaf-outline"
                            : "cube-outline"
                        }
                        size={21}
                        color={c.blue}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: "600",
                          color: c.ink,
                        }}
                      >
                        {group.lot.item.name}
                      </Text>
                      <Text style={s.muted}>
                        {stockKind(group) === "WASTE"
                          ? "Отходы на продажу"
                          : "Готовая продукция"}
                      </Text>
                    </View>
                    <View
                      style={{ flexShrink: 1, alignItems: "flex-end", gap: 3 }}
                    >
                      <Text
                        style={{
                          fontSize: 17,
                          fontWeight: "700",
                          color: c.ink,
                        }}
                      >
                        {mass(group.onHandKg.minus(group.reservedKg))}
                      </Text>
                      <Text style={s.muted}>Доступно</Text>
                    </View>
                  </View>
                  {group.reservedKg.gt(0) && (
                    <Text style={[s.muted, { marginTop: 8 }]}>
                      В наличии: {mass(group.onHandKg)} · В резерве:{" "}
                      {mass(group.reservedKg)}
                    </Text>
                  )}
                </View>
              ) : (
                <Card key={group.key}>
                  <Text style={s.section}>{group.lot.item.name}</Text>
                  <Text style={s.muted}>{group.location.name}</Text>
                  <Row label="В наличии" value={mass(group.onHandKg)} />
                  <Row
                    label="Доступно"
                    value={mass(group.onHandKg.minus(group.reservedKg))}
                  />
                  <Btn
                    secondary
                    title={
                      group.location.kind === "WIP"
                        ? "Вернуть на склад"
                        : "Переместить / выдать в плавку"
                    }
                    onPress={() =>
                      setup(
                        "Переместить сырьё",
                        "/inventory/transfer",
                        [
                          weight(),
                          opt(
                            "destinationId",
                            "Куда",
                            options(
                              rows("locations").filter(
                                (l) =>
                                  l.id !== group.locationId &&
                                  (!l.batch ||
                                    l.batch.status === "IN_PROGRESS"),
                              ),
                            ),
                          ),
                          reason,
                        ],
                        (v) => ({
                          ...v,
                          itemId: group.lot.itemId,
                          locationId: group.locationId,
                        }),
                      )
                    }
                  />
                  <Btn
                    secondary
                    title={
                      stockDetails === group.key
                        ? "Скрыть учётные операции"
                        : "Учётные операции и история"
                    }
                    onPress={() =>
                      setStockDetails(
                        stockDetails === group.key ? null : group.key,
                      )
                    }
                  />
                  {stockDetails === group.key &&
                    group.entries.map((r: any) => (
                      <View key={r.lotId} style={{ marginTop: 16 }}>
                        <Text style={s.muted}>
                          Поступление {date(r.lot.createdAt)} ·{" "}
                          {mass(r.onHandKg)}
                        </Text>
                        <Btn
                          secondary
                          title={
                            r.location.kind === "WIP"
                              ? "Вернуть на склад"
                              : "Переместить / выдать в плавку"
                          }
                          onPress={() => transfer(r)}
                        />
                        {stockKind(r) === "WASTE" && (
                          <Row
                            label="Назначение отходов"
                            value={wasteDestination(
                              r.lot.item.wasteDisposition,
                            )}
                          />
                        )}
                        {r.location.kind === "STORAGE" && (
                          <>
                            <View style={s.chips}>
                              <Btn
                                secondary
                                title="Резерв"
                                onPress={() =>
                                  setup(
                                    "Резерв партии",
                                    "/inventory/reserve",
                                    [weight(), reason],
                                    (v) => ({
                                      ...v,
                                      lotId: r.lotId,
                                      locationId: r.locationId,
                                    }),
                                  )
                                }
                              />
                              <Btn
                                secondary
                                title="Пересчёт"
                                onPress={() =>
                                  setup(
                                    "Инвентаризация",
                                    "/inventory/adjust",
                                    [
                                      weight(
                                        "countedKg",
                                        "Фактический остаток",
                                      ),
                                      reason,
                                    ],
                                    (v) => ({
                                      ...v,
                                      lotId: r.lotId,
                                      locationId: r.locationId,
                                      version: r.version,
                                    }),
                                  )
                                }
                              />
                            </View>
                            {stockKind(r) === "MATERIAL" &&
                              r.lot.purchaseLotId && (
                                <Btn
                                  secondary
                                  title="Вернуть поставщику"
                                  onPress={() =>
                                    setup(
                                      "Возврат поставщику",
                                      "/inventory/return-supplier",
                                      [weight(), reason],
                                      (v) => ({
                                        ...v,
                                        lotId: r.lotId,
                                        locationId: r.locationId,
                                      }),
                                    )
                                  }
                                />
                              )}
                            {stockKind(r) === "WASTE" && (
                              <>
                                <Btn
                                  secondary
                                  title="Переработать в сырьё"
                                  onPress={() =>
                                    setup(
                                      "Переработка отходов",
                                      "/waste/recover",
                                      [
                                        weight(),
                                        opt(
                                          "materialId",
                                          "Полученное сырьё",
                                          options(
                                            rows("items").filter(
                                              (i) => i.kind === "MATERIAL",
                                            ),
                                          ),
                                        ),
                                        weight("materialKg", "Вес сырья"),
                                        {
                                          ...opt(
                                            "remainingId",
                                            "Оставшиеся отходы",
                                            options(
                                              rows("items").filter(
                                                (i) => i.kind === "WASTE",
                                              ),
                                            ),
                                          ),
                                          required: false,
                                        },
                                        {
                                          ...weight(
                                            "remainingKg",
                                            "Вес остатка",
                                          ),
                                          required: false,
                                        },
                                        reason,
                                      ],
                                      (v) => ({
                                        lotId: r.lotId,
                                        locationId: r.locationId,
                                        quantityKg: v.quantityKg,
                                        reason: v.reason,
                                        outputs: [
                                          {
                                            itemId: v.materialId,
                                            quantityKg: v.materialKg,
                                          },
                                          ...(v.remainingId && v.remainingKg
                                            ? [
                                                {
                                                  itemId: v.remainingId,
                                                  quantityKg: v.remainingKg,
                                                },
                                              ]
                                            : []),
                                        ],
                                      }),
                                    )
                                  }
                                />
                                <Btn
                                  secondary
                                  title="Списать отходы"
                                  onPress={() =>
                                    setup(
                                      "Списание отходов",
                                      "/waste/dispose",
                                      [weight(), reason],
                                      (v) => ({
                                        ...v,
                                        lotId: r.lotId,
                                        locationId: r.locationId,
                                      }),
                                    )
                                  }
                                />
                              </>
                            )}
                          </>
                        )}
                        <Btn
                          secondary
                          title="История происхождения"
                          onPress={() => {
                            void api(`/trace/${r.lotId}`)
                              .then((t) =>
                                Alert.alert(
                                  "Происхождение партии",
                                  t.nodes
                                    .map(
                                      (n: any) =>
                                        `${n.item.name} · ${n.id.slice(0, 8)}${n.purchaseLot ? " · " + (n.purchaseLot.line.receipt.supplier?.name ?? "Без поставщика") : ""}`,
                                    )
                                    .join("\n"),
                                ),
                              )
                              .catch((e) => Alert.alert("Ошибка", e.message));
                          }}
                        />
                      </View>
                    ))}
                </Card>
              ),
            )}
          {!rows("stock").some((r) => r.location.name === stockWarehouse) &&
            !busy && <Empty text="На этом складе пока нет остатков." />}
          {rows("reservations").length > 0 && (
            <Text style={s.section}>Активные резервы</Text>
          )}
          {rows("reservations").map((r) => (
            <Card key={r.id}>
              <Row label={r.lot.item.name} value={`${fmt(r.remainingKg)} кг`} />
              <Btn
                secondary
                title="Снять резерв"
                onPress={() =>
                  setup("Снятие резерва", `/reservations/${r.id}/release`, [
                    reason,
                  ])
                }
              />
            </Card>
          ))}
        </>
      )}
      {section === "sales" && (
        <View style={s.productionTabs}>
          {(
            [
              ["sale", "Продажи"],
              ["report", "Отчёт"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: salesView === value }}
              onPress={() => setSalesView(value)}
              style={[
                s.productionTab,
                salesView === value && s.productionTabActive,
              ]}
            >
              <Text
                style={[
                  s.productionTabText,
                  { color: salesView === value ? c.white : c.muted },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {section === "sales" && salesView === "report" && <SalesSummary />}
      {section === "sales" && salesView === "sale" && (
        <>
          <Btn
            title="Продать продукцию"
            disabled={busy || !!error}
            onPress={() =>
              setForm({
                title: "Продажа продукции",
                saleStock: Object.fromEntries(
                  Array.from(saleProducts, ([id, p]) => [
                    id,
                    p.quantity.toString(),
                  ]),
                ),
                fields: [
                  {
                    key: "customerName",
                    label: "Кому продаём · имя / название",
                  },
                  opt(
                    "itemId",
                    "Готовая продукция",
                    Array.from(saleProducts, ([id, p]) => ({
                      id,
                      name: `${p.name} · доступно ${fmt(p.quantity)} кг`,
                    })),
                  ),
                  { key: "quantityKg", label: "Количество, кг", number: true },
                  {
                    ...opt("currency", "Валюта", [
                      { id: "USD", name: "Доллары США · USD" },
                      { id: "UZS", name: "Узбекские сумы · UZS" },
                    ]),
                    value: "USD",
                  },
                  {
                    key: "unitPricePerKg",
                    label: "Цена за 1 кг",
                    number: true,
                  },
                ],
                submit: (v, send) =>
                  send("/sales", {
                    customerName: v.customerName.trim(),
                    itemId: v.itemId,
                    quantityKg: v.quantityKg,
                    unitPricePerKg: v.unitPricePerKg,
                    currency: v.currency,
                  }),
              })
            }
          />
          <View style={s.chips}>
            <Btn
              title="+ Договор"
              onPress={() =>
                setForm({
                  title: "Новый договор",
                  fields: [
                    { key: "number", label: "Номер договора" },
                    opt("customerId", "Клиент", options(rows("customers"))),
                    currencies,
                    {
                      key: "plannedTruckCount",
                      label: "План машин",
                      number: true,
                      required: false,
                    },
                  ],
                  repeat: {
                    label: "Добавить позицию договора",
                    fields: [
                      opt(
                        "itemId",
                        "Продукция",
                        options(
                          rows("items").filter((i) => i.kind === "PRODUCT"),
                        ),
                      ),
                      weight("agreedQuantityKg", "Объём"),
                      {
                        key: "unitPricePerKg",
                        label: "Цена за кг",
                        number: true,
                      },
                    ],
                  },
                  allowDraft: true,
                  submit: (v, send) =>
                    send("/contracts", {
                      number: v.number,
                      customerId: v.customerId,
                      currency: v.currency,
                      ...(v.plannedTruckCount
                        ? { plannedTruckCount: Number(v.plannedTruckCount) }
                        : {}),
                      lines: formRows(v),
                    }),
                })
              }
            />
            <Btn
              secondary
              title="+ Клиент"
              onPress={() =>
                setup("Новый клиент", "/customers", [
                  { key: "name", label: "Название / имя" },
                  { key: "phone", label: "Телефон", required: false },
                ])
              }
            />
          </View>
          {filtered("contracts").map((ct) => (
            <Card key={ct.id}>
              <Text style={s.section}>{ct.number}</Text>
              <Text style={s.muted}>
                {ct.customer.name} · {status(ct.status)}
              </Text>
              {ct.lines.map((l: any) => {
                const shipped = l.shipmentLines
                  .filter((sl: any) => sl.shipment.document.status === "POSTED")
                  .reduce(
                    (a: Decimal, sl: any) => a.plus(sl.quantityKg),
                    new Decimal(0),
                  );
                return (
                  <View key={l.id}>
                    <Row
                      label={l.item.name}
                      value={`${fmt(l.agreedQuantityKg)} кг`}
                    />
                    <Row
                      label="Осталось отгрузить"
                      value={`${fmt(new Decimal(l.agreedQuantityKg).minus(shipped))} кг`}
                    />
                    <Row
                      label="Цена за кг"
                      value={`${fmt(l.unitPricePerKg)} ${ct.currency}`}
                    />
                  </View>
                );
              })}
              {ct.status === "ACTIVE" && (
                <Btn
                  title="Собрать отгрузку / машину"
                  onPress={() =>
                    setForm({
                      title: "Отгрузка по договору",
                      fields: [
                        { key: "vehicleNumber", label: "Госномер машины" },
                      ],
                      repeat: {
                        label: "Добавить партию",
                        fields: [
                          opt(
                            "source",
                            "Продукция и партия",
                            rows("stock")
                              .filter(
                                (r) =>
                                  ct.lines.some(
                                    (l: any) => l.itemId === r.lot.itemId,
                                  ) && r.location.kind === "STORAGE",
                              )
                              .map((r) => ({
                                id: `${r.lotId}:${r.locationId}:${r.lot.itemId}`,
                                name: itemName(r),
                              })),
                          ),
                          weight(),
                        ],
                      },
                      allowDraft: true,
                      submit: (v, send) => {
                        const grouped: Record<string, any[]> = {};
                        for (const row of formRows(v)) {
                          const [lotId, locationId, itemId] =
                            row.source.split(":");
                          (grouped[itemId] ??= []).push({
                            lotId,
                            locationId,
                            quantityKg: row.quantityKg,
                          });
                        }
                        return send("/shipments", {
                          customerId: ct.customerId,
                          contractId: ct.id,
                          currency: ct.currency,
                          kind: "PRODUCT",
                          vehicleNumber: v.vehicleNumber,
                          lines: Object.entries(grouped).map(
                            ([itemId, allocations]) => ({
                              itemId,
                              allocations,
                            }),
                          ),
                        });
                      },
                    })
                  }
                />
              )}
              <Row
                label="Машин выехало"
                value={String(
                  ct.shipments.filter(
                    (sh: any) =>
                      sh.departedAt && sh.document.status === "POSTED",
                  ).length,
                )}
              />
              {ct.status === "ACTIVE" && (
                <Btn
                  secondary
                  title="Изменить условия"
                  onPress={() =>
                    setForm({
                      title: "Условия договора",
                      fields: [
                        reason,
                        ...ct.lines.flatMap((l: any, i: number) => [
                          {
                            ...weight(`qty_${i}`, l.item.name + " · объём"),
                            value: l.agreedQuantityKg,
                          },
                          {
                            key: `price_${i}`,
                            label: l.item.name + " · цена за кг",
                            number: true,
                            value: l.unitPricePerKg,
                          },
                        ]),
                      ],
                      submit: (v) =>
                        mutate(`/contracts/${ct.id}/amend`, {
                          version: ct.version,
                          reason: v.reason,
                          lines: ct.lines.map((l: any, i: number) => ({
                            itemId: l.itemId,
                            agreedQuantityKg: v[`qty_${i}`],
                            unitPricePerKg: v[`price_${i}`],
                          })),
                        }),
                    })
                  }
                />
              )}
              {ct.status === "ACTIVE" && (
                <Btn
                  secondary
                  title="Закрыть договор"
                  onPress={() =>
                    setup("Закрытие договора", `/contracts/${ct.id}/close`, [
                      reason,
                    ])
                  }
                />
              )}
            </Card>
          ))}
          {!rows("contracts").length && !busy && (
            <Empty text="Для продажи нажмите «Продать продукцию». Договор можно оформить отдельно." />
          )}
          <Btn
            secondary
            title="Продать отходы"
            onPress={() =>
              setup(
                "Продажа отходов",
                "/shipments",
                [
                  opt("customerId", "Клиент", options(rows("customers"))),
                  opt(
                    "source",
                    "Партия отходов",
                    rows("stock")
                      .filter(
                        (r) =>
                          stockKind(r) === "WASTE" &&
                          r.location.kind === "STORAGE",
                      )
                      .map((r) => ({
                        id: `${r.lotId}:${r.locationId}:${r.lot.itemId}`,
                        name: itemName(r),
                      })),
                  ),
                  weight(),
                  currencies,
                  { key: "unitPricePerKg", label: "Цена за кг", number: true },
                  { key: "vehicleNumber", label: "Госномер машины" },
                ],
                (v) => ({
                  customerId: v.customerId,
                  currency: v.currency,
                  kind: "WASTE",
                  vehicleNumber: v.vehicleNumber,
                  lines: [
                    {
                      itemId: v.source.split(":")[2],
                      unitPricePerKg: v.unitPricePerKg,
                      allocations: [
                        {
                          lotId: v.source.split(":")[0],
                          locationId: v.source.split(":")[1],
                          quantityKg: v.quantityKg,
                        },
                      ],
                    },
                  ],
                }),
              )
            }
          />
          <Text style={s.section}>Отгрузки</Text>
          {filtered("shipments").map((sh) => (
            <Card key={sh.id}>
              <Text style={s.section}>
                {sh.vehicleNumber ?? "Продажа продукции"}
              </Text>
              <Text style={s.muted}>
                {sh.customer.name} · {date(sh.document.postedAt)}
              </Text>
              {sh.lines.map((l: any) => (
                <Row
                  key={l.id}
                  label={l.item.name}
                  value={`${fmt(l.quantityKg)} кг · ${fmt(l.amount)} ${sh.currency}`}
                />
              ))}
              <Row
                label="Статус"
                value={
                  sh.document.status === "REVERSED"
                    ? "Отменена"
                    : !sh.vehicleNumber
                      ? "Продано"
                      : sh.departedAt
                        ? "Машина выехала"
                        : "Ожидает выезда"
                }
              />
              {!!sh.vehicleNumber &&
                !sh.departedAt &&
                sh.document.status === "POSTED" && (
                  <Btn
                    secondary
                    title="Отметить выезд"
                    onPress={() =>
                      setup("Выезд машины", `/shipments/${sh.id}/depart`, [
                        reason,
                      ])
                    }
                  />
                )}
            </Card>
          ))}
        </>
      )}
      {section === "management" && (
        <>
          <Text style={s.section}>Черновики и незавершённые запросы</Text>
          {rows("drafts").map((d) => (
            <Card key={d.id}>
              <Text style={s.section}>
                {(
                  {
                    "/batches": "Новая плавка",
                    "/contracts": "Договор",
                    "/shipments": "Отгрузка",
                    "/inventory/transfer": "Перемещение",
                    "/purchase-receipts": "Приход сырья",
                  } as Record<string, string>
                )[d.route] ?? "Операция"}
              </Text>
              <Text style={s.muted}>
                {date(d.updatedAt)} ·{" "}
                {d.status === "DRAFT" ? "Черновик" : "Ожидает подтверждения"}
              </Text>
              <Text style={s.text}>
                {Object.entries(d.payload)
                  .filter(
                    ([k, v]) =>
                      [
                        "name",
                        "number",
                        "quantityKg",
                        "currency",
                        "vehicleNumber",
                      ].includes(k) && typeof v === "string",
                  )
                  .map(([, v]) => String(v))
                  .join(" · ")}
              </Text>
              <Btn
                title="Уточнить и завершить"
                onPress={() =>
                  Alert.alert(
                    "Завершить сохранённую операцию?",
                    "Сервер повторно проверит остатки и условия.",
                    [
                      { text: "Назад" },
                      {
                        text: "Продолжить",
                        onPress: () => {
                          void resumeDraft(d.id)
                            .then(() => {
                              void load();
                              onChanged();
                            })
                            .catch((e) => {
                              Alert.alert("Операция не завершена", e.message);
                              onChanged();
                            });
                        },
                      },
                    ],
                  )
                }
              />
              {d.status === "DRAFT" && (
                <Btn
                  secondary
                  title="Изменить значения"
                  onPress={() => {
                    const fields: Field[] = [];
                    const walk = (value: any, path: string[] = []): void => {
                      for (const [k, v] of Object.entries(value)) {
                        const keys = [...path, k];
                        if (v && typeof v === "object") walk(v, keys);
                        else if (
                          typeof v === "string" &&
                          !k.endsWith("Id") &&
                          !["unit", "kind", "reason", "notes"].includes(k)
                        )
                          fields.push({
                            key: keys.join("."),
                            label:
                              (
                                {
                                  quantityKg: "Вес, кг",
                                  quantity: "Количество",
                                  agreedQuantityKg: "Объём, кг",
                                  unitPricePerKg: "Цена за кг",
                                  reason: "Причина",
                                  notes: "Комментарий",
                                  name: "Название",
                                  number: "Номер",
                                  currency: "Валюта",
                                  vehicleNumber: "Машина",
                                } as Record<string, string>
                              )[k] ?? "Значение",
                            value: v,
                          });
                      }
                    };
                    walk(d.payload);
                    setForm({
                      title: "Изменить черновик",
                      fields,
                      submit: async (v) => {
                        const body = JSON.parse(JSON.stringify(d.payload));
                        for (const [key, value] of Object.entries(v)) {
                          const path = key.split(".");
                          let parent = body;
                          for (const part of path.slice(0, -1))
                            parent = parent[part];
                          parent[path[path.length - 1]] = value;
                        }
                        return editDraft(d.id, d.version, body);
                      },
                    });
                  }}
                />
              )}
              <Btn
                secondary
                title="Отменить черновик"
                onPress={() => {
                  void cancelDraft(d.id)
                    .then(() => void load())
                    .catch((e) =>
                      Alert.alert("Не удалось отменить", e.message),
                    );
                }}
              />
            </Card>
          ))}
          <Text style={s.section}>Редактирование справочников</Text>
          <Btn
            secondary
            title="Изменить запись"
            onPress={() =>
              setForm({
                title: "Выберите запись",
                fields: [
                  opt(
                    "record",
                    "Справочник",
                    [
                      "materials",
                      "items",
                      "suppliers",
                      "customers",
                      "equipment",
                    ].flatMap((k) =>
                      rows(k).map((r) => ({
                        id: k + ":" + r.id,
                        name:
                          (
                            {
                              materials: "Сырьё",
                              items: "Продукция / отходы",
                              suppliers: "Поставщик",
                              customers: "Клиент",
                              equipment: "Оборудование",
                            } as Record<string, string>
                          )[k] +
                          " · " +
                          r.name,
                      })),
                    ),
                  ),
                ],
                submit: async (v) => {
                  const [kind, id] = v.record.split(":");
                  const r = rows(kind).find((x) => x.id === id);
                  setTimeout(
                    () =>
                      setup(
                        "Изменить запись",
                        `/catalog/${kind}/${id}/edit`,
                        [
                          { key: "name", label: "Название", value: r.name },
                          {
                            ...opt("isActive", "Доступность", [
                              { id: "true", name: "Действует" },
                              { id: "false", name: "Отключена" },
                            ]),
                            value: String(r.isActive),
                          },
                          ...(kind === "items" && r.kind === "WASTE"
                            ? [
                                {
                                  ...opt(
                                    "wasteDisposition",
                                    "Что делать с отходом",
                                    wasteChoices,
                                  ),
                                  value: r.wasteDisposition ?? "",
                                },
                              ]
                            : []),
                          ...(["suppliers", "customers"].includes(kind)
                            ? [
                                {
                                  key: "phone",
                                  label: "Телефон",
                                  value: r.phone ?? "",
                                  required: false,
                                },
                                {
                                  key: "notes",
                                  label: "Комментарий",
                                  value: r.notes ?? "",
                                  required: false,
                                },
                              ]
                            : []),
                        ],
                        (vv) => ({
                          ...vv,
                          version: r.version,
                          isActive: vv.isActive === "true",
                        }),
                      ),
                    0,
                  );
                },
              })
            }
          />
          <Text style={s.section}>Владельцы</Text>
          {rows("users").map((u) => (
            <Card key={u.id}>
              <Row label={u.name} value={u.isActive ? "Активен" : "Отключён"} />
              <Text style={s.muted}>{u.login}</Text>
              <Btn
                secondary
                title="Изменить профиль"
                onPress={() =>
                  setup(
                    "Профиль владельца",
                    `/users/${u.id}/edit`,
                    [
                      { key: "name", label: "Имя", value: u.name },
                      {
                        ...opt("isActive", "Доступ", [
                          { id: "true", name: "Разрешён" },
                          { id: "false", name: "Отключён" },
                        ]),
                        value: String(u.isActive),
                      },
                    ],
                    (v) => ({
                      name: v.name,
                      isActive: v.isActive === "true",
                      version: u.version,
                    }),
                  )
                }
              />
            </Card>
          ))}
          <Btn
            secondary
            title="Добавить владельца"
            onPress={() =>
              setup(
                "Новый владелец",
                "/users",
                [
                  { key: "name", label: "Имя" },
                  { key: "login", label: "Логин" },
                  {
                    key: "password",
                    label: "Пароль · минимум 14 символов",
                    secure: true,
                  },
                ],
                undefined,
                "Новый владелец получит полный доступ к заводу.",
              )
            }
          />
          <Text style={s.section}>Активные подключения</Text>
          {rows("sessions").map((ss) => (
            <Card key={ss.id}>
              <Text style={s.text}>Устройство {ss.deviceId.slice(0, 8)}</Text>
              <Text style={s.muted}>{date(ss.createdAt)}</Text>
              <Btn
                secondary
                title="Завершить подключение"
                onPress={() =>
                  setup("Отзыв доступа", `/sessions/${ss.id}/revoke`, [reason])
                }
              />
            </Card>
          ))}
          <Btn
            secondary
            title="Добавить котёл"
            onPress={() =>
              setup("Оборудование", "/equipment", [
                { key: "name", label: "Название" },
                opt("direction", "Направление", [
                  { id: "COPPER", name: "Медь" },
                  { id: "BRASS", name: "Латунь" },
                ]),
              ])
            }
          />
          <Btn
            secondary
            title="Добавить складскую зону"
            onPress={() =>
              setup("Складская зона", "/locations", [
                { key: "name", label: "Название" },
              ])
            }
          />
          <View style={s.chips}>
            {[
              ["documents", "Документы"],
              ["audit", "История"],
            ].map(([k, n]) => (
              <Pressable
                key={k}
                onPress={() => setView(k)}
                style={[s.chip, view === k && s.chipOn]}
              >
                <Text style={s.text}>{n}</Text>
              </Pressable>
            ))}
          </View>
          {(view === "audit" ? filtered("audit") : filtered("documents")).map(
            (d) => (
              <Card key={d.id}>
                <Text style={s.section}>
                  {documentName(d.type ?? d.action)}
                </Text>
                <Text style={s.muted}>
                  {date(d.postedAt ?? d.recordedAt)} · {d.id.slice(0, 8)}
                </Text>
                {d.movements?.map((m: any) => (
                  <Row
                    key={m.id}
                    label={`${m.lot.item.name} · ${m.location.name}`}
                    value={`${fmt(m.signedQuantityKg)} кг`}
                  />
                ))}
                {d.type && d.type !== "REVERSAL" && d.status === "POSTED" && (
                  <Btn
                    secondary
                    title="Исправить через отмену"
                    onPress={() =>
                      setup(
                        "Отмена документа",
                        `/documents/${d.id}/reverse`,
                        [reason],
                        undefined,
                        "История сохранится. Сервер проверит последующие операции и выезд машины.",
                      )
                    }
                  />
                )}
              </Card>
            ),
          )}
        </>
      )}
      {Object.entries(cursors)
        .filter(([, v]) => v)
        .map(([route, cursor]) => (
          <Btn
            key={route}
            secondary
            title={`Загрузить ещё · ${{ batches: "плавки", shifts: "смены", contracts: "договоры", shipments: "отгрузки", documents: "документы", audit: "история", reservations: "резервы" }[route] ?? route}`}
            onPress={() => {
              void api("/" + route + "?cursor=" + encodeURIComponent(cursor!))
                .then((p) => {
                  setData((old) => ({
                    ...old,
                    [route]: [...(old[route] ?? []), ...p.items],
                  }));
                  setCursors((old) => ({ ...old, [route]: p.nextCursor }));
                })
                .catch((e) => setError(e.message));
            }}
          />
        ))}
      {form && (
        <Editor
          failed={onChanged}
          key={form.title}
          form={form}
          close={() => setForm(null)}
          saved={() => {
            setForm(null);
            void load();
            onChanged();
          }}
        />
      )}
    </View>
  );
}
type SalesSummaryData = {
  rows: {
    itemId: string;
    name: string;
    currency: string;
    quantityKg: string;
    amount: string;
  }[];
  totalKg: string;
  totals: { currency: string; amount: string }[];
};
function salesMonth(previous = false) {
  const now = new Date(Date.now() + 5 * 3600000);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - (previous ? 1 : 0);
  return {
    from: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}
const displayDay = (value: string) => value.split("-").reverse().join(".");
function SalesSummary() {
  const [range, setRange] = useState(() => salesMonth());
  const [preset, setPreset] = useState("month");
  const [fromText, setFromText] = useState(() => displayDay(range.from));
  const [toText, setToText] = useState(() => displayDay(range.to));
  const [data, setData] = useState<SalesSummaryData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [inputError, setInputError] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setData(null);
    api<SalesSummaryData>(`/reports/sales?from=${range.from}&to=${range.to}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [range]);
  const apply = () => {
    const parse = (value: string) => {
      if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return null;
      const iso = value.split(".").reverse().join("-");
      const d = new Date(`${iso}T00:00:00Z`);
      return Number.isFinite(d.getTime()) &&
        d.toISOString().slice(0, 10) === iso
        ? iso
        : null;
    };
    const from = parse(fromText.trim()),
      to = parse(toText.trim());
    if (!from || !to || from > to) {
      setInputError("Укажите верный период в формате ДД.ММ.ГГГГ.");
      return;
    }
    setInputError("");
    setRange({ from, to });
  };
  return (
    <View>
      <View style={[s.chips, { justifyContent: "center" }]}>
        {(
          [
            ["month", "Этот месяц"],
            ["previous", "Прошлый месяц"],
            ["custom", "Период"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: preset === value }}
            style={[s.chip, preset === value && s.chipOn]}
            onPress={() => {
              setPreset(value);
              setInputError("");
              if (value !== "custom") {
                const next = salesMonth(value === "previous");
                setRange(next);
                setFromText(displayDay(next.from));
                setToText(displayDay(next.to));
              }
            }}
          >
            <Text style={{ color: preset === value ? c.blue : c.muted }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {preset === "custom" && (
        <View style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>С даты</Text>
              <TextInput
                accessibilityLabel="Начало периода"
                style={s.input}
                value={fromText}
                onChangeText={setFromText}
                placeholder="ДД.ММ.ГГГГ"
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>По дату</Text>
              <TextInput
                accessibilityLabel="Конец периода включительно"
                style={s.input}
                value={toText}
                onChangeText={setToText}
                placeholder="ДД.ММ.ГГГГ"
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
          {!!inputError && <Text style={s.error}>{inputError}</Text>}
          <Btn title="Показать" onPress={apply} />
        </View>
      )}
      <Text style={[s.muted, { textAlign: "center", marginBottom: 16 }]}>
        {displayDay(range.from)} — {displayDay(range.to)} · включительно
      </Text>
      {busy && <ActivityIndicator color={c.blue} />}
      {!!error && (
        <View>
          <Text style={s.error}>{error}</Text>
          <Btn title="Повторить" onPress={() => setRange({ ...range })} />
        </View>
      )}
      {data && (
        <>
          <View
            style={{
              backgroundColor: c.softBlue,
              borderRadius: 16,
              padding: 14,
              marginBottom: 14,
              gap: 8,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: c.ink,
                  flex: 1,
                }}
              >
                Итого за период
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: c.ink,
                  flexShrink: 1,
                }}
              >
                {fmt(data.totalKg)} кг
              </Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {data.totals.map((total) => (
                <View
                  key={total.currency}
                  style={{ flexGrow: 1, flexBasis: 120, gap: 2 }}
                >
                  <Text style={{ fontSize: 11, color: c.muted }}>
                    {total.currency === "USD"
                      ? "Доллары США"
                      : "Узбекские сумы"}
                  </Text>
                  <Text
                    style={{ fontSize: 16, fontWeight: "700", color: c.blue }}
                  >
                    {fmt(total.amount)} {total.currency}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          {!data.rows.length ? (
            <Empty text="За этот период продаж нет." />
          ) : (
            data.rows.map((row) => (
              <Card key={`${row.itemId}:${row.currency}`}>
                <Text style={s.section}>{row.name}</Text>
                <Row label="Продано" value={`${fmt(row.quantityKg)} кг`} />
                <Row
                  label="Сумма продаж"
                  value={`${fmt(row.amount)} ${row.currency}`}
                />
              </Card>
            ))
          )}
        </>
      )}
    </View>
  );
}

export function Reports() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [filterForm, setFilterForm] = useState<Form | null>(null);
  const [detail, setDetail] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(
    new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  );
  const load = async (selected = filters) => {
    setBusy(true);
    try {
      setData(
        await api(
          `/reports?${from ? "from=" + encodeURIComponent(from) + "&" : ""}${to ? "to=" + encodeURIComponent(to) : ""}${Object.entries(
            selected,
          )
            .filter(([, v]) => v && v !== "all")
            .map(([k, v]) => "&" + k + "=" + encodeURIComponent(v))
            .join("")}`,
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <View>
      <Title title="Отчёты" sub="Масса, выпуск и продажи по данным завода" />
      <Card>
        <Text style={s.label}>Период · время Ташкента</Text>
        <TextInput
          style={s.input}
          value={from}
          onChangeText={setFrom}
          placeholder="Начало: ГГГГ-ММ-ДД"
          placeholderTextColor={c.muted}
        />
        <TextInput
          style={[s.input, { marginTop: 10 }]}
          value={to}
          onChangeText={setTo}
          placeholder="Конец, не включая: ГГГГ-ММ-ДД"
          placeholderTextColor={c.muted}
        />
        <Btn
          title={busy ? "Загрузка…" : "Показать отчёт"}
          disabled={busy}
          onPress={() => void load()}
        />
      </Card>
      <Btn
        secondary
        title="Фильтры: котёл, смена, клиент, поставщик"
        onPress={() => {
          void Promise.all(
            ["equipment", "shifts", "customers", "suppliers"].map((r) =>
              all("/" + r),
            ),
          )
            .then(([equipment, shifts, customers, suppliers]) =>
              setFilterForm({
                title: "Фильтры отчёта",
                fields: [
                  ["equipmentId", "Котёл", equipment],
                  ["shiftId", "Смена", shifts],
                  ["customerId", "Клиент", customers],
                  ["supplierId", "Поставщик", suppliers],
                ].map(([key, label, rows]: any) => ({
                  ...opt(key, label, [
                    { id: "all", name: "Все" },
                    ...options(rows, (r: any) =>
                      r.businessDate ? r.name + " · " + r.businessDate : r.name,
                    ),
                  ]),
                  value: filters[key] ?? "all",
                })),
                submit: async (v) => {
                  setFilters(v);
                  await load(v);
                },
              }),
            )
            .catch((e) => setError(e.message));
        }}
      />
      <Text style={[s.muted, { marginVertical: 10 }]}>
        Производство — по дате начала смены. Поставщик фильтрует закупки, клиент
        — продажи и договоры. Склад — текущий.
      </Text>
      {!!error && <Text style={s.error}>{error}</Text>}
      {data && (
        <>
          <Card>
            <Text style={s.section}>Производственный баланс</Text>
            <Row
              label="Переработано"
              value={`${fmt(data.production.inputKg)} кг`}
            />
            <Row
              label="Продукция"
              value={`${fmt(data.production.productKg)} кг`}
            />
            <Row label="Отходы" value={`${fmt(data.production.wasteKg)} кг`} />
            <Row
              label="Безвозвратные потери"
              value={`${fmt(data.production.lossKg ?? "0")} кг`}
            />
            <Row
              label="Доля отходов"
              value={
                data.production.wastePercent === null
                  ? "Нет завершённых плавок"
                  : `${data.production.wastePercent}%`
              }
            />
            {data.production.wasteBreakdown.map((w: any) => (
              <Row
                key={w.id}
                label={w.name}
                value={`${fmt(w.quantityKg)} кг · ${w.percentOfInput}%`}
              />
            ))}
          </Card>
          <Card>
            <Text style={s.section}>Движение отходов</Text>
            <Row
              label="Повторно использовано"
              value={`${fmt(data.waste.reusedKg)} кг`}
            />
            <Row label="Продано" value={`${fmt(data.waste.soldKg)} кг`} />
            <Row label="Списано" value={`${fmt(data.waste.disposedKg)} кг`} />
          </Card>
          <Card>
            <Text style={s.section}>Закупки</Text>
            {data.purchaseAmounts.map((a: any) => (
              <Row key={a.currency} label={a.currency} value={fmt(a.amount)} />
            ))}
          </Card>
          <Card>
            <Text style={s.section}>Продажи</Text>
            {data.saleAmounts.map((a: any) => (
              <Row key={a.currency} label={a.currency} value={fmt(a.amount)} />
            ))}
          </Card>
          <Card>
            <Text style={s.section}>Текущие остатки</Text>
            <Text style={s.muted}>
              На момент обновления, независимо от периода
            </Text>
            {data.stock.map((r: any) => (
              <Row
                key={`${r.lotId}:${r.locationId}`}
                label={`${r.lot.item.name} · ${r.location.name}`}
                value={`${fmt(r.onHandKg)} кг`}
              />
            ))}
          </Card>
          <View style={s.chips}>
            {[
              ["purchases", "Поступления"],
              ["sales", "Отгрузки"],
              ["movements", "Движения"],
            ].map(([k, n]) => (
              <Pressable
                key={k}
                style={[s.chip, detail === k && s.chipOn]}
                onPress={() => setDetail(detail === k ? "" : k)}
              >
                <Text style={s.text}>{n}</Text>
              </Pressable>
            ))}
          </View>
          {detail === "purchases" &&
            data.purchases.map((p: any) => (
              <Card key={p.id}>
                <Text style={s.section}>
                  {p.supplier?.name ?? "Без поставщика"}
                </Text>
                <Text style={s.muted}>{date(p.postedAt)}</Text>
                {p.lines.map((l: any) => (
                  <Row
                    key={l.id}
                    label={l.material.name}
                    value={`${fmt(l.quantityKg)} кг · ${fmt(l.amount)} ${p.currency}`}
                  />
                ))}
              </Card>
            ))}
          {detail === "sales" &&
            data.shipments.map((sh: any) => (
              <Card key={sh.id}>
                <Text style={s.section}>
                  {sh.customer.name} · {sh.vehicleNumber}
                </Text>
                <Text style={s.muted}>{date(sh.document.postedAt)}</Text>
                {sh.lines.map((l: any) => (
                  <Row
                    key={l.id}
                    label={l.item.name}
                    value={`${fmt(l.quantityKg)} кг · ${fmt(l.amount)} ${sh.currency}`}
                  />
                ))}
              </Card>
            ))}
          {detail === "movements" &&
            data.movements.map((m: any) => (
              <Card key={m.id}>
                <Text style={s.section}>{documentName(m.type)}</Text>
                <Text style={s.muted}>
                  {date(m.postedAt)} · {m.location.name}
                </Text>
                <Row
                  label={m.lot.item.name}
                  value={`${fmt(m.signedQuantityKg)} кг`}
                />
              </Card>
            ))}
          {data.production.batches.map((b: any) => (
            <Card key={b.id}>
              <Text style={s.section}>
                {b.equipment.name} · {b.shift.businessDate}
              </Text>
              <Text style={s.muted}>
                {b.shift.name} · {b.number}
              </Text>
              {b.outputs.map((o: any) => (
                <Row
                  key={o.id}
                  label={o.lot.item.name}
                  value={`${fmt(o.quantityKg)} кг`}
                />
              ))}
            </Card>
          ))}
        </>
      )}
      {filterForm && (
        <Editor
          form={filterForm}
          close={() => setFilterForm(null)}
          saved={() => setFilterForm(null)}
          failed={() => {}}
        />
      )}
    </View>
  );
}
type LeadOverview = {
  config: { productNames: string[]; countries: string[]; minimumOrderKg?: number; buyerTypes: string[]; outreachLanguages: string[]; intermediaryMode: string };
  readiness: { parametersReady: boolean; providerReady: boolean; missing: string[] };
  candidates: Array<{
    id: string;
    companyName: string;
    website: string;
    country?: string;
    city?: string;
    industry?: string;
    score: number;
    scoreExplanation: string;
    status: string;
    contactEmail?: string;
    contactPhone?: string;
    contactTelegram?: string;
    contactWhatsapp?: string;
    outreachLanguage?: string;
    outreachText?: string;
    evidence: Array<{ id: string; url: string; title?: string; excerpt?: string }>;
  }>;
  runs: Array<{ id: string; status: string; progressStage: string; targetCount: number; foundCount: number; createdAt: string; startedAt?: string; completedAt?: string; errorMessage?: string }>;
};

const leadStatus: Record<string, string> = {
  NEW: "Новый",
  VERIFIED: "Проверен",
  CONTACTED: "Связались",
  NEGOTIATION: "Переговоры",
  CUSTOMER: "Клиент",
  REJECTED: "Отказ",
};

const telegramUrl = (value: string) => value.startsWith("http") ? value : `https://t.me/${value.replace(/^@/, "")}`;
const whatsappUrl = (value: string) => value.startsWith("http") ? value : `https://wa.me/${value.replace(/\D/g, "")}`;

export function LeadAgent() {
  const [overview, setOverview] = useState<LeadOverview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [candidateLimit, setCandidateLimit] = useState("15");
  const [clock, setClock] = useState(Date.now());
  const load = async () => {
    setBusy(true);
    try {
      setOverview(await api<LeadOverview>("/lead-agent/overview"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => void load(), []);
  useEffect(() => {
    if (overview?.runs[0]?.status !== "RUNNING") return;
    const timer = setInterval(() => {
      setClock(Date.now());
      void load();
    }, 2000);
    return () => clearInterval(timer);
  }, [overview?.runs[0]?.status]);
  const activeRun = overview?.runs[0];
  const progress = activeRun?.progressStage === "SAVING" ? 88 : activeRun?.status === "COMPLETED" ? 100 : 34;
  const elapsedSeconds = activeRun?.startedAt ? Math.max(0, Math.floor((clock - new Date(activeRun.startedAt).getTime()) / 1000)) : 0;
  const changeStatus = async (id: string, next: string) => {
    try {
      await mutate(`/lead-agent/candidates/${id}/status`, { status: next });
      await load();
    } catch (e) {
      Alert.alert("Не удалось изменить статус", (e as Error).message);
    }
  };
  const start = async () => {
    const limit = Number(candidateLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      Alert.alert("Проверьте количество", "Укажите целое число от 1 до 50.");
      return;
    }
    try {
      await mutate("/lead-agent/runs", { limit });
      await load();
      Alert.alert("Поиск начат", "Агент ищет и проверяет компании. Результаты появятся в карточках через несколько минут.");
    } catch (e) {
      Alert.alert("Поиск пока недоступен", (e as Error).message);
    }
  };
  if (busy && !overview) return <ActivityIndicator color={c.blue} />;
  return (
    <View>
      <Card>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.section}>ИИ-поиск клиентов</Text>
            <Text style={s.muted}>Кандидаты из открытых источников с проверяемым рейтингом</Text>
          </View>
          <Ionicons name="sparkles-outline" size={28} color={c.blue} />
        </View>
        <Row label="Параметры поиска" value={overview?.readiness.parametersReady ? "Готовы" : "Ожидаются"} />
        <Row label="OpenAI" value={overview?.readiness.providerReady ? "Подключён" : "Не подключён"} />
        <Row label="Продукция" value={overview?.config.productNames.join(", ") || "—"} />
        <Row label="Страны" value={overview?.config.countries.join(", ") || "—"} />
        <Row label="Минимальная партия" value={`${overview?.config.minimumOrderKg ?? 0} кг`} />
        <Row label="Посредники" value="Исключены" />
        <Text style={[s.label, { marginTop: 10 }]}>Сколько кандидатов искать</Text>
        <TextInput
          style={s.input}
          value={candidateLimit}
          onChangeText={(value) => setCandidateLimit(value.replace(/\D/g, "").slice(0, 2))}
          keyboardType="number-pad"
          placeholder="От 1 до 50"
        />
        {!!overview?.readiness.missing.length && (
          <View style={{ marginTop: 8 }}>
            <Text style={s.label}>Нужно указать позже</Text>
            <View style={s.chips}>
              {overview.readiness.missing.map((item) => <Text key={item} style={s.chip}>{item}</Text>)}
            </View>
          </View>
        )}
        <Btn title="Начать поиск" onPress={start} disabled={!overview?.readiness.parametersReady || !overview?.readiness.providerReady} />
        <Text style={[s.muted, { marginTop: 10 }]}>Сообщения кандидатам не отправляются автоматически. Сначала владелец проверяет компанию.</Text>
        {activeRun?.status === "RUNNING" && (
          <View style={s.searchProgress}>
            <View style={s.row}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
                <ActivityIndicator size="small" color={c.blue} />
                <View>
                  <Text style={s.label}>{activeRun.progressStage === "SAVING" ? "Сохраняем найденные компании" : "Агент ищет компании"}</Text>
                  <Text style={s.muted}>{elapsedSeconds} сек. · можно оставить экран открытым</Text>
                </View>
              </View>
              <Text style={s.badge}>{activeRun.foundCount}/{activeRun.targetCount}</Text>
            </View>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${progress}%` }]} />
            </View>
            <Text style={s.muted}>{activeRun.foundCount ? `Найдено подходящих: ${activeRun.foundCount}` : "Проверяем сайты, контакты и соответствие продукции…"}</Text>
          </View>
        )}
        {overview?.runs[0]?.status === "FAILED" && <Text style={[s.error, { marginTop: 8 }]}>Последний поиск завершился ошибкой: {overview.runs[0].errorMessage}</Text>}
      </Card>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Text style={s.section}>Кандидаты · {overview?.candidates.length ?? 0}</Text>
      {!overview?.candidates.length ? (
        <Empty text="После настройки здесь появятся компании, рейтинг, контакты и ссылки на источники." />
      ) : overview.candidates.map((lead) => (
        <Card key={lead.id}>
          <View style={s.row}>
            <Text style={[s.section, { flex: 1 }]}>{lead.companyName}</Text>
            <Text style={s.badge}>{lead.score}/100</Text>
          </View>
          <Text style={s.muted}>{[lead.industry, lead.city, lead.country].filter(Boolean).join(" · ")}</Text>
          <Text style={[s.text, { marginTop: 10 }]}>{lead.scoreExplanation}</Text>
          <Row label="Статус" value={leadStatus[lead.status] ?? lead.status} />
          {!!lead.contactEmail && <Row label="E-mail" value={lead.contactEmail} />}
          {!!lead.contactPhone && <Row label="Телефон" value={lead.contactPhone} />}
          {!!lead.contactPhone && <Btn title="Позвонить" secondary onPress={() => void Linking.openURL(`tel:${lead.contactPhone!.replace(/[^+\d]/g, "")}`)} />}
          {!!lead.contactTelegram && <Btn title="Открыть Telegram" secondary onPress={() => void Linking.openURL(telegramUrl(lead.contactTelegram!))} />}
          {!!lead.contactWhatsapp && <Btn title="Открыть WhatsApp" secondary onPress={() => void Linking.openURL(whatsappUrl(lead.contactWhatsapp!))} />}
          {!!lead.contactEmail && <Btn title="Написать по почте" secondary onPress={() => void Linking.openURL(`mailto:${lead.contactEmail}?subject=${encodeURIComponent("Предложение от MRBA")}&body=${encodeURIComponent(lead.outreachText || "")}`)} />}
          <Btn title="Открыть сайт" secondary onPress={() => void Linking.openURL(lead.website)} />
          {!!lead.outreachText && (
            <View style={{ marginTop: 12 }}>
              <Text style={s.label}>Текст обращения · {lead.outreachLanguage || "язык сайта"}</Text>
              <Text style={s.text}>{lead.outreachText}</Text>
              <Btn title="Поделиться текстом" secondary onPress={() => void Share.share({ message: lead.outreachText! })} />
            </View>
          )}
          {!!lead.evidence.length && (
            <View style={{ marginTop: 12 }}>
              <Text style={s.label}>Источники</Text>
              {lead.evidence.map((source, index) => (
                <Pressable key={source.id} onPress={() => void Linking.openURL(source.url)} style={{ paddingVertical: 7 }}>
                  <Text style={{ color: c.blue, fontWeight: "600" }}>{index + 1}. {source.title || source.url}</Text>
                  {!!source.excerpt && <Text style={s.muted}>{source.excerpt}</Text>}
                </Pressable>
              ))}
            </View>
          )}
          <View style={s.chips}>
            {(["VERIFIED", "CONTACTED", "NEGOTIATION", "REJECTED"] as const).map((next) => (
              <Pressable key={next} style={[s.chip, lead.status === next && s.chipOn]} onPress={() => void changeStatus(lead.id, next)}>
                <Text style={s.text}>{leadStatus[next]}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  searchProgress: {
    marginTop: 12,
    padding: 13,
    borderRadius: 14,
    backgroundColor: c.softBlue,
    borderWidth: 1,
    borderColor: "#D8E5FF",
  },
  progressTrack: {
    height: 6,
    overflow: "hidden",
    borderRadius: 6,
    backgroundColor: "#D4DFF3",
    marginVertical: 9,
  },
  progressFill: { height: 6, borderRadius: 6, backgroundColor: c.blue },
  productionTabs: {
    flexDirection: "row",
    alignSelf: "center",
    width: "100%",
    maxWidth: 380,
    padding: 5,
    gap: 5,
    borderRadius: 18,
    backgroundColor: c.line,
    marginBottom: 18,
  },
  productionTab: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  productionTabActive: {
    backgroundColor: c.blue,
  },
  productionTabText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },

  modal: { flex: 1, backgroundColor: c.bg },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 22,
    borderBottomWidth: 1,
    borderColor: c.line,
  },
  card: {
    backgroundColor: c.white,
    borderRadius: 20,
    padding: 19,
    borderWidth: 1,
    borderColor: c.line,
    marginBottom: 14,
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: c.ink,
    marginVertical: 8,
    letterSpacing: -0.8,
  },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 2, color: c.blue },
  section: { fontSize: 18, fontWeight: "600", color: c.ink, marginVertical: 6 },
  text: { fontSize: 14, color: c.ink, lineHeight: 21 },
  muted: { fontSize: 13, color: c.muted, lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginVertical: 8,
  },
  value: { fontSize: 14, fontWeight: "600", color: c.ink },
  button: {
    backgroundColor: c.blue,
    borderRadius: 13,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  secondary: { backgroundColor: c.softBlue },
  buttonText: { color: "white", fontWeight: "600", fontSize: 14 },
  input: {
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 13,
    padding: 15,
    fontSize: 16,
    color: c.ink,
    minHeight: 50,
  },
  label: { fontSize: 13, fontWeight: "600", color: c.ink, marginBottom: 9 },
  options: { gap: 7 },
  option: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.white,
  },
  optionOn: { borderColor: c.blue, backgroundColor: c.softBlue },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 10 },
  chip: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.line,
  },
  chipOn: { backgroundColor: c.softBlue, borderColor: c.blue },
  error: { color: "#B84040", fontSize: 14, lineHeight: 21, marginVertical: 12 },
  badge: {
    fontSize: 11,
    fontWeight: "600",
    color: c.green,
    backgroundColor: "#E8F4F0",
    padding: 7,
    borderRadius: 8,
  },
});

export function CatalogActions({
  onChanged,
  disabled = false,
}: {
  onChanged: () => void;
  disabled?: boolean;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [productItems, setProductItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [wasteItems, setWasteItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const loadCatalog = async () => {
    setLoading(true);
    try {
      const items = await all<any>("/items");
      setProductItems(items.filter((i) => i.kind === "PRODUCT"));
      setWasteItems(items.filter((i) => i.kind === "WASTE"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadCatalog();
  }, []);
  const open = (kind: "PRODUCT" | "WASTE") =>
    setForm({
      title: kind === "PRODUCT" ? "Новая продукция" : "Новый вид отходов",
      fields: [
        { key: "name", label: "Название" },
        ...(kind === "WASTE"
          ? [opt("wasteDisposition", "Что делать с отходом", wasteChoices)]
          : []),
      ],
      allowDraft: true,
      submit: (v, send) => send("/items", { ...v, kind }),
    });
  return (
    <View>
      {!!error && <Text style={s.error}>{error}</Text>}
      {loading && <ActivityIndicator color={c.blue} />}
      <Text style={[s.section, { marginTop: 16 }]}>
        Готовая продукция · {productItems.length}
      </Text>
      <Btn
        secondary
        title="+ Продукция"
        disabled={disabled}
        onPress={() => open("PRODUCT")}
      />
      {!loading && !error && productItems.length === 0 && (
        <Text style={s.muted}>Продукция пока не добавлена.</Text>
      )}
      {productItems.map((item) => (
        <Card key={item.id}>
          <Text style={s.section}>{item.name}</Text>
          {!item.isActive && <Text style={s.muted}>Отключена</Text>}
          <Btn
            secondary
            title="Изменить"
            disabled={disabled}
            onPress={() =>
              setForm({
                title: "Изменить продукцию",
                fields: [{ key: "name", label: "Название", value: item.name }],
                submit: (v, send) =>
                  send(`/catalog/items/${item.id}/edit`, {
                    name: v.name,
                    version: item.version,
                    isActive: item.isActive,
                  }),
              })
            }
          />
        </Card>
      ))}
      <Text style={[s.section, { marginTop: 20 }]}>
        Виды отходов · {wasteItems.length}
      </Text>
      <Btn
        secondary
        title="+ Вид отходов"
        disabled={disabled}
        onPress={() => open("WASTE")}
      />
      {wasteItems.length === 0 && !error && !loading && (
        <Text style={s.muted}>Виды отходов пока не добавлены.</Text>
      )}
      {wasteItems.map((item) => (
        <Card key={item.id}>
          <Text style={s.section}>{item.name}</Text>
          <Row
            label="Назначение"
            value={wasteDestination(item.wasteDisposition)}
          />
          {!item.isActive && <Text style={s.muted}>Отключён</Text>}
          <Btn
            secondary
            title="Изменить"
            disabled={disabled}
            onPress={() =>
              setForm({
                title: "Изменить вид отходов",
                fields: [
                  { key: "name", label: "Название", value: item.name },
                  {
                    ...opt(
                      "wasteDisposition",
                      "Что делать с отходом",
                      wasteChoices,
                    ),
                    value: item.wasteDisposition ?? "",
                  },
                ],
                submit: (v, send) =>
                  send(`/catalog/items/${item.id}/edit`, {
                    ...v,
                    version: item.version,
                    isActive: item.isActive,
                  }),
              })
            }
          />
        </Card>
      ))}
      {form && (
        <Editor
          form={form}
          close={() => setForm(null)}
          saved={() => {
            setForm(null);
            void loadCatalog();
            onChanged();
          }}
          failed={onChanged}
        />
      )}
    </View>
  );
}
