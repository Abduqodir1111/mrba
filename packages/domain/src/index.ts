import Decimal from "decimal.js";
Decimal.set({ precision: 60 });
export const FACTORY_TIMEZONE = "Asia/Tashkent";
export const CURRENCIES = ["UZS", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];
export type WeightUnit = "kg" | "t";
export function toKg(value: string, unit: WeightUnit): string {
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(value))
    throw new Error("INVALID_WEIGHT");
  const kg = new Decimal(value).times(unit === "t" ? 1000 : 1);
  if (kg.lte(0) || kg.decimalPlaces() > 0 || kg.greaterThan("999999999999"))
    throw new Error("INVALID_WEIGHT");
  return kg.toFixed(0);
}
export function displayWeight(kg: string, unit: WeightUnit): string {
  return new Decimal(kg).dividedBy(unit === "t" ? 1000 : 1).toString();
}
export function currentShift(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FACTORY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  const hour = Number(get("hour"));
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // A night shift belongs to the factory-local date on which it starts.
  const local = new Date(`${date}T00:00:00+05:00`);
  if (hour < 8) local.setUTCDate(local.getUTCDate() - 1);
  const startDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: FACTORY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(local);
  const day = hour >= 8 && hour < 20;
  const startsAt = new Date(`${startDate}T${day ? "08" : "20"}:00:00+05:00`);
  return {
    businessDate: startDate,
    code: day ? "DAY" : "NIGHT",
    name: day ? "Дневная смена" : "Ночная смена",
    hours: day ? "08:00 — 20:00" : "20:00 — 08:00",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 12 * 3600000).toISOString(),
  };
}
