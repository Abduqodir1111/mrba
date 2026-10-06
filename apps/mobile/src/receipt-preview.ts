import Decimal from "decimal.js";

export function receiptSummary(lines: any[]) {
  const groups = new Map<string, any>();
  for (const line of lines) {
    if (line.status !== "POSTED") continue;
    const key = `${line.materialId}:${line.currency}`;
    const group = groups.get(key) ?? {
      key, name: line.material.name, currency: line.currency, count: 0, unpriced: 0,
      gross: new Decimal(0), returned: new Decimal(0), manual: new Decimal(0),
      percent: new Decimal(0), total: new Decimal(0), payable: new Decimal(0),
      amount: new Decimal(0), pricedKg: new Decimal(0), percentages: new Set<string>(),
    };
    const total = new Decimal(line.grossKg).minus(line.returnedKg);
    const payable = total.minus(line.discountKg).minus(line.percentDiscountKg ?? 0);
    group.count++;
    group.gross = group.gross.plus(line.grossKg);
    group.returned = group.returned.plus(line.returnedKg);
    group.manual = group.manual.plus(line.discountKg);
    group.percent = group.percent.plus(line.percentDiscountKg ?? 0);
    group.total = group.total.plus(total);
    group.payable = group.payable.plus(payable);
    group.percentages.add(new Decimal(line.discountPercent ?? 0).toString());
    if (line.priceKnown) {
      group.amount = group.amount.plus(line.amount);
      group.pricedKg = group.pricedKg.plus(payable);
    } else group.unpriced++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "ru") || a.currency.localeCompare(b.currency));
}

export function receiptPreview(grossKg: string, minimumReturn: string, values: Record<string, string>, priceRequired: boolean) {
  const read = (key: string, pattern: RegExp) => {
    const text = (values[key] ?? "").trim().replace(",", ".");
    return pattern.test(text) ? new Decimal(text) : null;
  };
  const returned = read("returnedKg", /^\d{1,12}$/);
  const discount = read("discountKg", /^\d{1,12}$/);
  const percent = read("discountPercent", /^\d{1,3}(?:\.\d{1,2})?$/);
  const hasPrice = !!values.unitPricePerKg?.trim();
  const price = read("unitPricePerKg", /^\d{1,12}(?:\.\d{1,6})?$/);
  if (!returned || !discount || !percent || returned.lt(minimumReturn) || percent.gt(100)) return null;
  const total = new Decimal(grossKg).minus(returned);
  if (total.lte(0) || discount.gt(total) || (hasPrice && !price?.gt(0)) || (priceRequired && !hasPrice)) return null;
  const percentKg = total.minus(discount).times(percent).div(100).toDecimalPlaces(3);
  const discounted = discount.plus(percentKg);
  const payable = total.minus(discounted);
  return { total, percentKg, discounted, payable, amount: price ? payable.times(price) : null };
}
