import { PurchaseLine, PurchaseRevision } from "@prisma/client";
export const revisionInclude = { orderBy: { version: "desc" as const }, take: 1 };
export function effectivePurchase<T extends PurchaseLine & { revisions: PurchaseRevision[] }>(line: T) {
  const revision = line.revisions[0];
  return { ...line, ...revision, id: line.id, version: revision?.version ?? 0 };
}
