import {
  KeyboardAwareScrollView,
  KeyboardProvider,
} from "react-native-keyboard-controller";
import { Workspace, Reports, CatalogActions, LeadAgent } from "./src/features";
import Decimal from "decimal.js";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  api,
  all,
  login,
  logout,
  restore,
  mutate,
  saveDraft,
  pending,
  resolvePending,
} from "./src/api";
import { theme as c } from "./src/theme";

Decimal.set({ precision: 60 });
function openPublicPage(url: string) {
  void Linking.openURL(url).catch(() => Alert.alert("Не удалось открыть страницу", "Попробуйте открыть mrba.uz в браузере."));
}
type Tab = "Главная" | "Склад" | "Производство" | "Продажи" | "Ещё";
type Named = { id: string; name: string };
type Dashboard = {
  site: { city: string };
  owner: string;
  shift: { name: string; hours: string };
  generatedAt: string;
  stockKg: string;
  stockByMaterial: { id: string; name: string; quantityKg: string }[];
  purchases: number;
  materials: number;
  suppliers: number;
  purchaseAmounts: { currency: string; amount: string }[];
  recent: any[];
};
const tabs: { label: Tab; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: "Главная", icon: "grid-outline" },
  { label: "Склад", icon: "cube-outline" },
  { label: "Производство", icon: "flame-outline" },
  { label: "Продажи", icon: "trending-up-outline" },
  { label: "Ещё", icon: "ellipsis-horizontal" },
];
const format = (value: string, max = 9) => {
  const [whole, fraction] = new Decimal(value)
    .toFixed(Math.min(new Decimal(value).decimalPlaces(), max))
    .split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ") +
    (fraction ? "," + fraction : "")
  );
};
const clock = (date: string) =>
  new Date(date).toLocaleTimeString("ru-RU", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
function Icon({
  name,
  color = c.ink,
  size = 22,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color?: string;
  size?: number;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}
function Button({
  title,
  onPress,
  busy,
  secondary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.buttonSecondary,
        (disabled || pressed) && { opacity: 0.5 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? c.blue : "white"} />
      ) : (
        <Text style={[s.buttonText, secondary && { color: c.blue }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#A0AAB3" style={s.input} {...props} />
    </View>
  );
}
function Empty({
  title,
  text,
  icon = "file-tray-outline",
}: {
  title: string;
  text: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={28} color={c.muted} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}
function Heading({
  title,
  link,
  onPress,
}: {
  title: string;
  link?: string;
  onPress?: () => void;
}) {
  return (
    <View style={s.heading}>
      <Text style={s.sectionTitle}>{title}</Text>
      {link && (
        <Pressable accessibilityRole="button" onPress={onPress} hitSlop={12}>
          <Text style={s.link}>{link} →</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <StatusBar style="dark" />
        <FactoryApp />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
function FactoryApp() {
  const [authenticated, setAuthenticated] = useState(false);
  const [boot, setBoot] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("Главная");
  const [moreView, setMoreView] = useState<"menu" | "reports" | "management" | "leads">(
    "menu",
  );
  const [data, setData] = useState<Dashboard | null>(null);
  const [materials, setMaterials] = useState<Named[]>([]);
  const [suppliers, setSuppliers] = useState<Named[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [unresolved, setUnresolved] = useState(false);
  const [modal, setModal] = useState<
    "purchase" | "material" | "supplier" | null
  >(null);
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState<"kg" | "t">("t");

  async function reload() {
    setBusy(true);
    try {
      const [dashboard, m, sp, ls] = await Promise.all([
        api<Dashboard>("/dashboard"),
        all<Named>("/materials"),
        all<Named>("/suppliers"),
        all<any>("/inventory/lots"),
      ]);
      setData(dashboard);
      setMaterials(m);
      setSuppliers(sp);
      setLots(ls);
      setError("");
      setUnresolved(Boolean(await pending()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        if (await restore()) setAuthenticated(true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBoot(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (authenticated) void reload();
  }, [authenticated]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && authenticated) void reload();
    });
    return () => sub.remove();
  }, [authenticated]);
  useEffect(() => {
    if (!authenticated) return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active" && !modal) void reload();
    }, 60000);
    return () => clearInterval(timer);
  }, [authenticated, modal]);
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await login(loginName, password);
      setPassword("");
      setAuthenticated(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    try {
      await logout();
      setData(null);
      setLots([]);
      setMaterials([]);
      setSuppliers([]);
      setAuthenticated(false);
      setTab("Главная");
      setError("");
    } catch (e) {
      Alert.alert("Не удалось выйти", (e as Error).message);
    }
  }
  async function resolve() {
    try {
      const result = await resolvePending();
      setUnresolved(false);
      await reload();
      Alert.alert(
        "Результат получен",
        result?.type === "CANCELLED"
          ? "Запрос отменён. Изменений не внесено."
          : "Операция подтверждена сервером.",
      );
    } catch (e) {
      Alert.alert(
        "Результат уточняется",
        `${(e as Error).message}\nНе создавайте повторную операцию.`,
      );
    }
  }
  const canWrite = !error && !unresolved && !busy;
  const open = (kind: typeof modal) => {
    if (canWrite) setModal(kind);
  };
  if (boot)
    return (
      <SafeAreaView style={s.boot}>
        <View style={s.logo}>
          <Text style={s.logoText}>M</Text>
        </View>
        <Text style={s.brand}>MRBA</Text>
        <ActivityIndicator color={c.blue} />
      </SafeAreaView>
    );
  if (!authenticated)
    return (
      <SafeAreaView style={s.page}>
        <View style={{ flex: 1 }}>
          <KeyboardAwareScrollView
            bottomOffset={24}
            keyboardDismissMode="on-drag"
            contentContainerStyle={s.login}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.brandRow}>
              <View style={s.logo}>
                <Text style={s.logoText}>M</Text>
              </View>
              <View>
                <Text style={s.brand}>MRBA</Text>
                <Text style={s.overline}>FACTORY MANAGEMENT</Text>
              </View>
            </View>
            <View style={{ marginTop: 66, gap: 15 }}>
              <Text style={s.loginTitle}>
                Ваш завод.{"\n"}Всё под контролем.
              </Text>
              <Text style={s.loginSubtitle}>
                Производство, склад и продажи —{"\n"}в одном пространстве.
              </Text>
            </View>
            <View style={{ marginTop: 42, gap: 20 }}>
              <Field
                label="Логин"
                placeholder="Введите логин"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                value={loginName}
                onChangeText={setLoginName}
              />
              <Field
                label="Пароль"
                placeholder="Введите пароль"
                secureTextEntry
                textContentType="password"
                value={password}
                onChangeText={setPassword}
              />
              {loginName.trim().toLowerCase() === "review@mrba.uz" ? <Text style={s.muted}>Демонстрационная среда · учебные данные</Text> : null}
              {error ? <Text style={s.errorText}>{error}</Text> : null}
              <Button
                title="Войти в систему   →"
                onPress={signIn}
                busy={busy}
                disabled={!loginName || !password}
              />
            </View>
            <View style={s.loginFooter}>
              <Icon name="shield-checkmark-outline" color={c.green} size={18} />
              <Text style={s.muted}>Защищённый доступ владельца</Text>
            </View>
            <Pressable accessibilityRole="link" onPress={() => openPublicPage("https://mrba.uz/privacy")} style={{ paddingVertical: 12 }}>
              <Text style={[s.muted, { textAlign: "center" }]}>Политика конфиденциальности</Text>
            </Pressable>
            <Text style={s.location}>КАТТАКУРГАН · УЗБЕКИСТАН</Text>
          </KeyboardAwareScrollView>
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView edges={["top"]} style={s.page}>
      {error ? (
        <Pressable onPress={reload} style={s.banner}>
          <Icon name="cloud-offline-outline" size={18} color="#A95132" />
          <Text style={s.bannerText}>Нет актуальных данных · Повторить</Text>
        </Pressable>
      ) : null}
      {unresolved ? (
        <Pressable onPress={resolve} style={s.banner}>
          <Icon name="time-outline" size={18} color={c.orange} />
          <Text style={s.bannerText}>
            Уточнить результат последней операции →
          </Text>
        </Pressable>
      ) : null}
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardDismissMode="on-drag"
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={reload}
            tintColor={c.blue}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {tab === "Главная" && (
          <>
            <LinearGradient
              colors={["#193C56", "#102A3F"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.hero}
            >
              <View style={s.heroTop}>
                <View style={s.shiftTag}>
                  <Icon
                    name={
                      data?.shift.name.startsWith("Дневная")
                        ? "sunny-outline"
                        : "moon-outline"
                    }
                    color="#A7C5DE"
                    size={16}
                  />
                  <Text style={s.heroLabel}>
                    {data?.shift.name ?? "Текущая смена"}
                  </Text>
                </View>
                <Text style={s.heroHours}>{data?.shift.hours ?? "—"}</Text>
              </View>
              <Text style={s.heroCaption}>
                Основной склад · сырьё и возвратные отходы
              </Text>
              <View style={s.heroValueRow}>
                <Text style={s.heroValue}>
                  {data
                    ? format(new Decimal(data.stockKg).div(1000).toString())
                    : "—"}
                </Text>
                <Text style={s.heroUnit}>т</Text>
              </View>
              <View style={{ marginTop: 18 }}>
                {data?.stockByMaterial?.map((material) => (
                  <View key={material.id} style={s.heroMaterialRow}>
                    <Text style={s.heroMaterialName}>{material.name}</Text>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text style={s.heroMaterialWeight}>
                        {format(material.quantityKg)} кг
                      </Text>
                      <Text style={s.heroSmall}>
                        {format(
                          new Decimal(material.quantityKg).div(1000).toString(),
                        )}{" "}
                        т
                      </Text>
                    </View>
                  </View>
                ))}
                {data && !data.stockByMaterial?.length && (
                  <Text style={s.heroSmall}>
                    На Основном складе пока нет остатков
                  </Text>
                )}
              </View>
              <View style={s.heroBottom}>
                <Text style={s.heroSmall}>
                  {data ? `${format(data.stockKg)} кг` : "Загрузка данных"}
                </Text>
                <View style={s.heroDivider} />
                <Text style={s.heroSmall}>
                  {data?.purchases ?? "—"} поступлений
                </Text>
                <View style={{ flex: 1 }} />
                <Icon name="cube-outline" color="#91B5D0" size={26} />
              </View>
            </LinearGradient>
            <Heading title="Закупки" />
            <View style={s.currencyCard}>
              {["UZS", "USD"].map((currency, i) => (
                <View
                  key={currency}
                  style={[s.currencyRow, i === 0 && s.borderBottom]}
                >
                  <View style={s.currencyBadge}>
                    <Text style={s.currencyCode}>{currency}</Text>
                  </View>
                  <Text style={s.currencyName}>
                    {currency === "UZS" ? "Узбекский сум" : "Доллар США"}
                  </Text>
                  <Text style={s.currencyValue}>
                    {data
                      ? format(
                          data.purchaseAmounts.find(
                            (x) => x.currency === currency,
                          )?.amount ?? "0",
                          9,
                        )
                      : "—"}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={s.footnote}>
              За всё время · Каждая валюта учитывается отдельно
            </Text>
            <Heading
              title="Последние поступления"
              link="Склад"
              onPress={() => setTab("Склад")}
            />
            {!data?.recent.length ? (
              <Empty
                title="Начнём с первого поступления"
                text="Во вкладке «Склад» нажмите «Принять сырьё» и укажите название и вес."
              />
            ) : (
              <View style={s.list}>
                {data.recent.map((r, i) => (
                  <View key={r.id} style={[s.listRow, i > 0 && s.borderTop]}>
                    <View style={s.receiptIcon}>
                      <Icon name="arrow-down" color={c.green} />
                    </View>
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text style={s.rowTitle}>
                        {Array.from(
                          new Set(
                            r.lines
                              .map(
                                (line: any) =>
                                  line.material?.name ??
                                  materials.find(
                                    (m) => m.id === line.materialId,
                                  )?.name,
                              )
                              .filter(Boolean),
                          ),
                        ).join(", ") || "Сырьё"}
                      </Text>
                      <Text style={s.muted}>
                        {clock(r.postedAt)} · {r.lines.length} поз.
                      </Text>
                    </View>
                    <Text style={s.rowTitle}>
                      +{" "}
                      {format(
                        r.lines
                          .reduce(
                            (n: Decimal, l: any) => n.plus(l.quantityKg),
                            new Decimal(0),
                          )
                          .toString(),
                      )}{" "}
                      кг
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
        {tab === "Склад" && (
          <>
            <Button
              title="+ Принять сырьё"
              onPress={() => open("purchase")}
              disabled={!canWrite}
            />
            <Workspace section="inventory" onChanged={() => void reload()} />
          </>
        )}
        {tab === "Производство" && (
          <Workspace section="production" onChanged={() => void reload()} />
        )}
        {tab === "Продажи" && (
          <Workspace section="sales" onChanged={() => void reload()} />
        )}
        {tab === "Ещё" && (
          <>
            {moreView !== "menu" && (
              <Button
                title="← Управление"
                secondary
                onPress={() => setMoreView("menu")}
              />
            )}
            {moreView === "reports" && <Reports />}
            {moreView === "management" && (
              <Workspace section="management" onChanged={() => void reload()} />
            )}
            {moreView === "leads" && <LeadAgent />}
            {moreView === "menu" && (
              <>
                <View style={s.profile}>
                  <View style={s.profileAvatar}>
                    <Text style={s.profileLetter}>В</Text>
                  </View>
                  <View>
                    <Text style={s.sectionTitle}>
                      {data?.owner ?? "Владелец"}
                    </Text>
                    <Text style={s.muted}>Полный доступ ко всем функциям</Text>
                  </View>
                </View>
                <View style={s.actions}>
                  <Action
                    icon="bar-chart-outline"
                    title="Отчёты"
                    subtitle="Выпуск, отходы и продажи"
                    onPress={() => setMoreView("reports")}
                  />
                  <Action
                    icon="settings-outline"
                    title="Контроль"
                    subtitle="Справочники и история"
                    onPress={() => setMoreView("management")}
                  />
                  <Action
                    icon="sparkles-outline"
                    title="Поиск клиентов"
                    subtitle="ИИ-кандидаты, рейтинг и проверка"
                    onPress={() => setMoreView("leads")}
                  />
                </View>
                <Heading title="Справочники" />
                <CatalogActions
                  disabled={!canWrite}
                  onChanged={() => void reload()}
                />
                <View style={s.actions}>
                  <Action
                    icon="people-outline"
                    title="Поставщик"
                    subtitle={`${suppliers.length} в справочнике`}
                    onPress={() => open("supplier")}
                    disabled={!canWrite}
                  />
                </View>
                <Heading title="Параметры завода" />
                <View style={s.list}>
                  {[
                    ["Местоположение", "Каттакурган"],
                    ["Область", "Самаркандская"],
                    ["Время", "Asia/Tashkent"],
                    ["Дневная смена", "08:00 — 20:00"],
                    ["Ночная смена", "20:00 — 08:00"],
                    ["Дата ночной смены", "Дата начала"],
                    ["Валюты", "UZS · USD"],
                    ["Вес", "Целые кг · тонны"],
                  ].map(([key, value], i) => (
                    <View
                      key={key}
                      style={[s.settingsRow, i > 0 && s.borderTop]}
                    >
                      <Text style={s.muted}>{key}</Text>
                      <Text style={s.settingValue}>{value}</Text>
                    </View>
                  ))}
                </View>
                <Button title="Политика конфиденциальности" secondary onPress={() => openPublicPage("https://mrba.uz/privacy")} />
                <Button title="Поддержка" secondary onPress={() => openPublicPage("https://mrba.uz/support")} />
                <Button
                  title="Выйти из аккаунта"
                  secondary
                  onPress={() =>
                    Alert.alert("Выйти?", "Данные сохранены на сервере.", [
                      { text: "Отмена" },
                      { text: "Выйти", style: "destructive", onPress: signOut },
                    ])
                  }
                />
              </>
            )}
          </>
        )}
        <View style={s.updated}>
          <View
            style={[s.dot, { backgroundColor: error ? c.orange : c.green }]}
          />
          <Text style={s.footnote}>
            {data
              ? `Обновлено в ${clock(data.generatedAt)} · Время Ташкента`
              : "Подключение к серверу"}
          </Text>
        </View>
      </KeyboardAwareScrollView>
      <SafeAreaView edges={["bottom"]} style={s.tabBar}>
        <View style={s.tabRow}>
          {tabs.map((t) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.label }}
              key={t.label}
              onPress={() => setTab(t.label)}
              style={s.tab}
            >
              <View style={s.tabIcon}>
                <Icon
                  name={t.icon}
                  color={tab === t.label ? c.blue : c.muted}
                  size={23}
                />
              </View>
              <Text
                style={[
                  s.tabLabel,
                  tab === t.label && { color: c.blue, fontWeight: "700" },
                ]}
              >
                {t.label}
              </Text>
              <View
                style={[s.tabIndicator, { opacity: tab === t.label ? 1 : 0 }]}
              />
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
      {modal && (
        <EntryModal
          kind={modal}
          materials={materials}
          suppliers={suppliers}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await reload();
          }}
          onAmbiguous={() => setUnresolved(true)}
        />
      )}
    </SafeAreaView>
  );
}
function Action({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.action, disabled && { opacity: 0.5 }]}
    >
      <View style={s.actionIcon}>
        <Icon name={icon} color={c.blue} />
      </View>
      <Text style={s.actionTitle}>{title}</Text>
      <Text style={s.actionSubtitle}>{subtitle}</Text>
    </Pressable>
  );
}
function EntryModal({
  kind,
  materials,
  suppliers,
  onClose,
  onSaved,
  onAmbiguous,
}: {
  kind: "purchase" | "material" | "supplier";
  materials: Named[];
  suppliers: Named[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onAmbiguous: () => void;
}) {
  const [name, setName] = useState("");
  const [material, setMaterial] = useState(materials.length ? "" : "new");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("t");
  const [currency, setCurrency] = useState("UZS");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(draft = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await (draft ? saveDraft : mutate)(
        kind === "purchase"
          ? "/purchase-receipts"
          : kind === "material"
            ? "/materials"
            : "/suppliers",
        kind === "purchase"
          ? {
              currency,
              lines: [
                {
                  ...(material === "new"
                    ? { materialName: name.trim() }
                    : { materialId: material }),
                  quantity: quantity.replace(",", "."),
                  unit,
                  unitPricePerKg: price.replace(",", "."),
                },
              ],
            }
          : { name },
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      if (await pending()) onAmbiguous();
    } finally {
      setBusy(false);
    }
  }
  const title =
    kind === "purchase"
      ? "Принять сырьё"
      : kind === "material"
        ? "Новый материал"
        : "Новый поставщик";
  function confirm() {
    if (kind !== "purchase") return void save();
    Alert.alert(
      "Подтвердить поступление?",
      `${material === "new" ? name.trim() : materials.find((m) => m.id === material)?.name}\n${quantity} ${unit === "t" ? "т" : "кг"}\nЦена: ${price} ${currency}/кг\nСырьё будет добавлено на склад.`,
      [
        { text: "Отмена" },
        { text: "Принять сырьё", onPress: () => void save() },
      ],
    );
  }
  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardProvider>
        <SafeAreaView edges={["top", "bottom"]} style={[s.page, { flex: 1 }]}>
          <View style={s.modalHeader}>
            <Text style={s.sectionTitle}>{title}</Text>
            <Pressable
              accessibilityLabel="Закрыть"
              disabled={busy}
              onPress={onClose}
              style={s.close}
            >
              <Icon name="close" />
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
            <KeyboardAwareScrollView
              bottomOffset={24}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 24, gap: 22 }}
            >
              {kind !== "purchase" ? (
                <Field
                  label="Название"
                  placeholder={
                    kind === "material"
                      ? "Например, медный лом"
                      : "Название компании"
                  }
                  value={name}
                  onChangeText={setName}
                />
              ) : (
                <>
                  <Choices
                    label="Сырьё"
                    items={[
                      ...materials.map((x) => ({ value: x.id, label: x.name })),
                      { value: "new", label: "+ Новый вид сырья" },
                    ]}
                    selected={material}
                    onSelect={setMaterial}
                  />
                  {material === "new" && (
                    <Field
                      label="Название сырья"
                      placeholder="Например, медный лом"
                      value={name}
                      onChangeText={setName}
                    />
                  )}
                  <Choices
                    label="Единица веса"
                    items={[
                      { value: "t", label: "Тонны" },
                      { value: "kg", label: "Килограммы" },
                    ]}
                    selected={unit}
                    onSelect={setUnit}
                  />
                  <Field
                    label={`Вес, ${unit === "t" ? "т" : "кг"}`}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    value={quantity}
                    onChangeText={setQuantity}
                  />
                  <Choices
                    label="Валюта"
                    items={[
                      { value: "UZS", label: "UZS · Сум" },
                      { value: "USD", label: "USD · Доллар" },
                    ]}
                    selected={currency}
                    onSelect={setCurrency}
                  />
                  <Field
                    label={`Цена за 1 кг, ${currency}`}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    value={price}
                    onChangeText={setPrice}
                  />
                  <View style={s.notice}>
                    <Icon name="shield-checkmark-outline" color={c.green} />
                    <Text style={s.noticeText}>
                      Остаток изменится только после подтверждения сервером.
                    </Text>
                  </View>
                </>
              )}
              {error ? <Text style={s.errorText}>{error}</Text> : null}
              <Button
                title={
                  kind === "purchase"
                    ? "Принять сырьё"
                    : kind === "supplier"
                      ? "Добавить поставщика"
                      : "Добавить сырьё"
                }
                onPress={confirm}
                busy={busy}
                disabled={
                  kind === "purchase"
                    ? !material ||
                      (material === "new" && !name.trim()) ||
                      !quantity ||
                      !price
                    : !name.trim()
                }
              />
            </KeyboardAwareScrollView>
          </View>
        </SafeAreaView>
      </KeyboardProvider>
    </Modal>
  );
}
function Choices({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: { value: string; label: string }[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.label}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {items.map((item) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === item.value }}
            key={item.value}
            onPress={() => onSelect(item.value)}
            style={[s.choice, selected === item.value && s.choiceActive]}
          >
            <Text
              style={{
                color: selected === item.value ? c.blue : c.ink,
                fontWeight: "500",
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    backgroundColor: c.bg,
  },
  content: { padding: 22, gap: 16, paddingBottom: 26 },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: c.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: "white", fontSize: 30, fontWeight: "800" },
  smallLogo: {
    width: 39,
    height: 39,
    borderRadius: 12,
    backgroundColor: c.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  smallLogoText: { color: "white", fontSize: 24, fontWeight: "800" },
  brand: { fontSize: 27, fontWeight: "800", letterSpacing: 2, color: c.ink },
  overline: { fontSize: 9, letterSpacing: 1.8, color: c.muted, marginTop: 4 },
  headerBrand: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: 1.8,
    color: c.ink,
  },
  headerLocation: { fontSize: 11, color: c.muted, marginTop: 3 },
  avatar: {
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: "#E9EEF4",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 17, fontWeight: "600", color: c.ink },
  avatarDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: c.green,
    borderWidth: 2,
    borderColor: c.bg,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.8,
    color: c.muted,
    marginBottom: 7,
  },
  title: { fontSize: 29, fontWeight: "700", letterSpacing: -0.8, color: c.ink },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  online: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#EAF3EE",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.green },
  onlineText: { fontSize: 10, fontWeight: "600", color: c.green },
  hero: { padding: 22, borderRadius: 24, overflow: "hidden" },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  shiftTag: { flexDirection: "row", alignItems: "center", gap: 7 },
  heroLabel: { fontSize: 12, color: "#C0D4E3", fontWeight: "500" },
  heroHours: { fontSize: 12, color: "#A4C1D5", fontVariant: ["tabular-nums"] },
  heroCaption: { fontSize: 14, color: "#BDD0DD", marginTop: 28 },
  heroValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    marginTop: 5,
  },
  heroValue: {
    fontSize: 54,
    fontWeight: "600",
    color: "white",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  heroUnit: { fontSize: 25, color: "#91B0C6" },
  heroBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderTopWidth: 1,
    borderColor: "#345065",
    marginTop: 20,
    paddingTop: 16,
  },
  heroMaterialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#36536A",
  },
  heroMaterialName: {
    flex: 1,
    color: "#E8F1F7",
    fontSize: 16,
    fontWeight: "500",
  },
  heroMaterialWeight: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  heroSmall: { fontSize: 12, color: "#ADC5D6" },
  heroDivider: { width: 1, height: 12, backgroundColor: "#466073" },
  metrics: { flexDirection: "row", gap: 12 },
  metric: {
    flex: 1,
    backgroundColor: c.white,
    borderRadius: 19,
    padding: 17,
    borderWidth: 1,
    borderColor: c.line,
  },
  metricIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 11,
  },
  metricValue: { fontSize: 26, fontWeight: "700", color: c.ink },
  metricLabel: { fontSize: 12, color: c.muted, marginTop: 3 },
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: c.ink,
    letterSpacing: -0.3,
  },
  link: { fontSize: 12, fontWeight: "600", color: c.blue },
  actions: { flexDirection: "row", gap: 12 },
  action: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: "white",
    borderRadius: 18,
    padding: 16,
    gap: 6,
  },
  actionIcon: { marginBottom: 7 },
  actionTitle: { fontSize: 14, fontWeight: "600", color: c.ink },
  actionSubtitle: { fontSize: 11, color: c.muted },
  currencyCard: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 18,
    backgroundColor: "white",
    paddingHorizontal: 15,
  },
  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    gap: 10,
  },
  currencyBadge: {
    backgroundColor: c.bg,
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  currencyCode: { fontSize: 11, fontWeight: "700", color: c.ink },
  currencyName: { fontSize: 12, color: c.muted, flex: 1 },
  currencyValue: {
    fontSize: 17,
    fontWeight: "600",
    color: c.ink,
    fontVariant: ["tabular-nums"],
  },
  footnote: { fontSize: 10, color: c.muted, lineHeight: 15 },
  borderBottom: { borderBottomWidth: 1, borderColor: c.line },
  borderTop: { borderTopWidth: 1, borderColor: c.line },
  empty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#D7DFE6",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 9,
  },
  emptyIcon: {
    backgroundColor: "#EAF0F4",
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: c.ink,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 13,
    color: c.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  list: {
    backgroundColor: "white",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    paddingHorizontal: 15,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    gap: 12,
  },
  receiptIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#EAF5EF",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 14, fontWeight: "600", color: c.ink },
  muted: { fontSize: 12, color: c.muted, lineHeight: 19 },
  updated: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
  },
  tabBar: { backgroundColor: "white", borderTopWidth: 1, borderColor: c.line },
  tabRow: { flexDirection: "row", paddingTop: 8, paddingHorizontal: 6 },
  tab: { flex: 1, alignItems: "center", gap: 4, paddingBottom: 6 },
  tabIcon: { paddingHorizontal: 13, paddingVertical: 3 },
  tabIndicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.blue,
  },
  tabLabel: { fontSize: 9, fontWeight: "500", color: c.muted },
  button: {
    minHeight: 54,
    borderRadius: 15,
    backgroundColor: c.blue,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonSecondary: { backgroundColor: c.softBlue },
  buttonText: { fontSize: 15, fontWeight: "600", color: "white" },
  label: { fontSize: 13, fontWeight: "600", color: c.ink },
  input: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 14,
    paddingHorizontal: 17,
    paddingVertical: 16,
    fontSize: 16,
    color: c.ink,
    minHeight: 54,
  },
  errorText: { color: "#B14635", fontSize: 13, lineHeight: 20 },
  login: {
    paddingHorizontal: 30,
    paddingTop: 40,
    paddingBottom: 25,
    flexGrow: 1,
  },
  loginTitle: {
    fontSize: 37,
    fontWeight: "700",
    lineHeight: 44,
    letterSpacing: -1.3,
    color: c.ink,
  },
  loginSubtitle: { fontSize: 15, lineHeight: 24, color: c.muted },
  loginFooter: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 26,
  },
  location: {
    fontSize: 9,
    letterSpacing: 2,
    color: "#98A2AA",
    textAlign: "center",
    marginTop: 48,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: "#FFF1E4",
  },
  bannerText: { fontSize: 12, color: "#865D37", flex: 1 },
  search: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 15,
    padding: 15,
    alignItems: "center",
  },
  segment: {
    flexDirection: "row",
    backgroundColor: "#E9EDF1",
    borderRadius: 9,
    padding: 3,
  },
  segmentItem: { padding: 8, borderRadius: 7 },
  segmentActive: { backgroundColor: "white" },
  lot: {
    backgroundColor: "white",
    borderRadius: 18,
    padding: 17,
    borderWidth: 1,
    borderColor: c.line,
    gap: 5,
  },
  lotWeight: { fontSize: 17, fontWeight: "700", color: c.ink },
  profile: {
    backgroundColor: "white",
    padding: 20,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    borderWidth: 1,
    borderColor: c.line,
  },
  profileAvatar: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: c.softBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  profileLetter: { fontSize: 24, fontWeight: "600", color: c.blue },
  settingsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  settingValue: { fontSize: 13, fontWeight: "500", color: c.ink },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 24,
    paddingBottom: 16,
  },
  close: {
    backgroundColor: "#E5EAF0",
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  choice: {
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 12,
    backgroundColor: "white",
  },
  choiceActive: { borderColor: c.blue, backgroundColor: c.softBlue },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EAF5EF",
    padding: 16,
    borderRadius: 14,
    gap: 10,
  },
  noticeText: { fontSize: 12, color: c.green, flex: 1, lineHeight: 18 },
});
