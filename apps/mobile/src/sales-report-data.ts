import Decimal from "decimal.js";

export type ReportSale = {
  id: string; customerId?: string; customerName: string; occurredAt: string;
  currency: string; quantityKg: string; amount: string;
  lines: { id: string; itemId: string; name: string; quantityKg: string; unitPricePerKg: string; amount: string }[];
};
export type SaleReportRow = {
  key: string; customerName: string; name: string; currency: string;
  count: number; quantityKg: string; amount: string; unitPrice: string | null;
  entries: { saleId: string; occurredAt: string; quantityKg: string; unitPricePerKg: string; amount: string }[];
};

// Count documents, not lines; use exact decimal amounts for weighted prices.
export function saleReportRows(sales: ReportSale[], grouped: boolean): SaleReportRow[] {
  const groups = new Map<string, SaleReportRow>();
  for (const sale of sales) for (const line of sale.lines) {
    const key = JSON.stringify(grouped
      ? [sale.customerId ?? sale.customerName.trim().toLocaleLowerCase("ru"), line.itemId, sale.currency]
      : [sale.id, line.id]);
    const row = groups.get(key) ?? {
      key, customerName: sale.customerName, name: line.name, currency: sale.currency,
      count: 0, quantityKg: "0", amount: "0", unitPrice: null, entries: [],
    };
    row.quantityKg = new Decimal(row.quantityKg).plus(line.quantityKg).toString();
    row.amount = new Decimal(row.amount).plus(line.amount).toString();
    row.entries.push({ saleId: sale.id, occurredAt: sale.occurredAt, quantityKg: line.quantityKg, unitPricePerKg: line.unitPricePerKg, amount: line.amount });
    row.count = new Set(row.entries.map(entry => entry.saleId)).size;
    row.unitPrice = grouped
      ? new Decimal(row.quantityKg).gt(0) ? new Decimal(row.amount).div(row.quantityKg).toString() : null
      : line.unitPricePerKg;
    groups.set(key, row);
  }
  const rows = [...groups.values()];
  return grouped ? rows.sort((a, b) => a.customerName.localeCompare(b.customerName, "ru") || a.name.localeCompare(b.name, "ru") || a.currency.localeCompare(b.currency)) : rows;
}
