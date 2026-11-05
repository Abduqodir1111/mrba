import Decimal from "decimal.js";
export type CompletionProduct = { itemId: string; quantity: string };
export function completionProducts(rows: CompletionProduct[], unit: "kg" | "t", allowedIds: string[]) {
  const seen = new Set<string>();
  return rows.flatMap((row, index) => {
    const value = row.quantity.trim().replace(",", ".") || "0";
    let kg: Decimal;
    try { kg = new Decimal(value).times(unit === "t" ? 1000 : 1); }
    catch { throw Error(`Проверьте вес продукции №${index + 1}`); }
    if (!kg.isFinite() || kg.lt(0) || kg.decimalPlaces() > 3) throw Error(`Вес продукции №${index + 1}: укажите неотрицательное число до 0,001 кг`);
    if (kg.isZero()) return [];
    if (!allowedIds.includes(row.itemId)) throw Error(`Выберите вид продукции №${index + 1}`);
    if (seen.has(row.itemId)) throw Error("Один вид продукции выбран несколько раз. Объедините его вес в одной позиции.");
    seen.add(row.itemId);
    return [{ itemId: row.itemId, quantityKg: kg.toFixed() }];
  });
}
