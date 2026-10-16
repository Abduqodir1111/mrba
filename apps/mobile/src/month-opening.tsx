import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import Decimal from "decimal.js";
import { api, mutate } from "./api";
import { confirmAction } from "./confirm-action";
import { theme as c } from "./theme";
type Line = {
  key: string;
  itemId: string;
  locationId: string;
  sourceLotId?: string;
  name: string;
  location: string;
  before: string;
  quantity: string;
  price: string;
  currency: "UZS" | "USD";
  inherited: any;
};
const numeric = (v: string) => v.trim().replace(/\s/g, "").replace(",", ".");
const field = {
  borderWidth: 1,
  borderColor: c.line,
  borderRadius: 10,
  padding: 12,
  color: c.ink,
  backgroundColor: c.white,
  minHeight: 44,
} as const;
function Choice({
  title,
  values,
  value,
  onChange,
}: {
  title: string;
  values: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.muted, fontSize: 12 }}>{title}</Text>
      <Pressable
        accessibilityRole="button"
        style={field}
        onPress={() => setOpen(!open)}
      >
        <Text style={{ color: c.ink }}>
          {values.find((v) => v.id === value)?.name ?? "Выбрать"} ▾
        </Text>
      </Pressable>
      {open &&
        values.map((v) => (
          <Pressable
            key={v.id}
            style={{ padding: 10 }}
            onPress={() => {
              onChange(v.id);
              setOpen(false);
            }}
          >
            <Text style={{ color: c.ink }}>{v.name}</Text>
          </Pressable>
        ))}
    </View>
  );
}
export function MonthOpening({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<any>(null),
    [lines, setLines] = useState<Line[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [item, setItem] = useState(""),
    [location, setLocation] = useState("");
  useEffect(() => {
    void api("/month-closes/opening")
      .then((r) => {
        setData(r);
        setLocation(r.locations[0]?.id ?? "");
        setLines(
          r.rows.map((row: any) => {
            const currencies = Object.keys(row.unitCost.amounts);
            return {
              key: `${row.lotId}:${row.locationId}`,
              itemId: row.lot.itemId,
              locationId: row.locationId,
              sourceLotId: row.lotId,
              name: row.lot.item.name,
              location: row.location.name,
              before: row.onHandKg,
              quantity: "",
              price: "",
              currency: currencies[0] ?? "UZS",
              inherited: row.unitCost,
            };
          }),
        );
      })
      .catch((e) => setError(e.message));
  }, []);
  function change(key: string, values: Partial<Line>) {
    setLines((current) =>
      current.map((l) => (l.key === key ? { ...l, ...values } : l)),
    );
  }
  async function save() {
    setError("");
    setBusy(true);
    try {
      const positive = lines
        .filter((l) => l.quantity.trim() !== "")
        .map((l) => {
          const quantity = numeric(l.quantity),
            price = numeric(l.price);
          if (!/^\d{1,12}(?:\.\d{1,3})?$/.test(quantity))
            throw Error(`Проверьте фактический вес: ${l.name} (до 0,001 кг)`);
          if (price && !/^\d{1,12}(?:\.\d{1,6})?$/.test(price))
            throw Error(`Проверьте стоимость за кг: ${l.name}`);
          return {
            itemId: l.itemId,
            locationId: l.locationId,
            ...(l.sourceLotId ? { sourceLotId: l.sourceLotId } : {}),
            quantityKg: quantity,
            ...(price ? { unitPricePerKg: price, currency: l.currency } : {}),
          };
        });
      await mutate("/month-closes/opening", {
        closeId: data.closeId,
        lines: positive,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <View>
        {error ? (
          <Text style={{ color: "#B43F36" }}>{error}</Text>
        ) : (
          <ActivityIndicator color={c.blue} />
        )}
      </View>
    );
  const total = lines.reduce((sum, l) => {
    try {
      return sum.plus(numeric(l.quantity) || 0);
    } catch {
      return sum;
    }
  }, new Decimal(0));
  return (
    <View style={{ gap: 14 }}>
      <Text style={{ fontSize: 19, fontWeight: "700", color: c.ink }}>
        Пересчёт складов
      </Text>
      <Text style={{ color: c.muted, lineHeight: 20 }}>
        Склады обнулены после отчёта №{data.number}. Введите фактический вес
        сырья, продукции и отходов. Пустой вес означает нулевой остаток. Это
        начальные остатки, а не новая закупка.
      </Text>
      {lines.map((l) => (
        <View
          key={l.key}
          style={{
            gap: 10,
            padding: 14,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: c.line,
            backgroundColor: c.white,
          }}
        >
          <Text style={{ fontWeight: "700", color: c.ink }}>{l.name}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {l.location} · В закрытом отчёте: {l.before} кг
          </Text>
          <Text style={{ color: c.ink }}>Фактический вес, кг</Text>
          <TextInput
            accessibilityLabel={`Фактический вес · ${l.name}`}
            style={field}
            keyboardType="decimal-pad"
            value={l.quantity}
            onChangeText={(v) => change(l.key, { quantity: v })}
            placeholder="0"
          />
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {l.inherited?.known
              ? `Если цену не менять, используется стоимость за кг из закрытого отчёта: ${
                  Object.entries(l.inherited.amounts)
                    .map(([currency, amount]) => `${amount} ${currency}`)
                    .join(" + ") || "0"
                }.`
              : "Стоимость не определена. Укажите её, чтобы рассчитывать себестоимость."}
          </Text>
          <Text style={{ color: c.ink }}>
            Новая стоимость за кг (необязательно)
          </Text>
          <TextInput
            accessibilityLabel={`Стоимость за кг · ${l.name}`}
            style={field}
            keyboardType="decimal-pad"
            value={l.price}
            onChangeText={(v) => change(l.key, { price: v })}
            placeholder="Из закрытого отчёта"
          />
          {!!l.price && (
            <Choice
              title="Валюта"
              value={l.currency}
              values={[
                { id: "UZS", name: "UZS · Сум" },
                { id: "USD", name: "USD · Доллар" },
              ]}
              onChange={(v) => change(l.key, { currency: v as "UZS" | "USD" })}
            />
          )}
        </View>
      ))}
      <View
        style={{
          gap: 10,
          padding: 14,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 14,
        }}
      >
        <Text style={{ fontWeight: "700", color: c.ink }}>
          Добавить другую позицию
        </Text>
        <Choice
          title="Сырьё / продукция / отходы"
          values={data.items}
          value={item}
          onChange={setItem}
        />
        <Choice
          title="Склад"
          values={data.locations.map((l: any) => ({
            id: l.id,
            name: `${l.warehouse.name} · ${l.name}`,
          }))}
          value={location}
          onChange={setLocation}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!item || !location || busy}
          style={field}
          onPress={() => {
            const key = `new:${item}:${location}`;
            if (lines.some((l) => l.key === key)) return;
            setLines((current) => [
              ...current,
              {
                key,
                itemId: item,
                locationId: location,
                name: data.items.find((i: any) => i.id === item).name,
                location: data.locations.find((i: any) => i.id === location)
                  .name,
                before: "0",
                quantity: "",
                price: "",
                currency: "UZS",
                inherited: null,
              },
            ]);
            setItem("");
          }}
        >
          <Text style={{ color: c.blue }}>+ Добавить позицию</Text>
        </Pressable>
      </View>
      <Text style={{ fontWeight: "700", color: c.ink }}>
        Фактические остатки: {total.toString()} кг
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#B43F36" }}>
          {error}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={[field, { backgroundColor: c.blue }]}
        onPress={() =>
          confirmAction({
            title: "Подтвердить фактические остатки?",
            message: `Будет принято ${total.toString()} кг. Все позиции с пустым весом останутся нулевыми. Старые веса и суммы останутся в закрытом отчёте.`,
            confirmText: "Подтвердить остатки",
            onConfirm: save,
          })
        }
      >
        <Text
          style={{ color: "white", textAlign: "center", fontWeight: "700" }}
        >
          {busy ? "Сохранение…" : "Подтвердить фактические остатки"}
        </Text>
      </Pressable>
    </View>
  );
}
