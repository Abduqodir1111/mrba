import Decimal from "decimal.js";

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
