import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

// Do not let a reversal or count resurrect stock written off at a period reset.
// Period IDs, rather than timestamps, also cover commands that waited for closure.
export async function assertCurrentStockDocument(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const reset = await tx.monthClose.findFirst({
    where: { stockReset: true },
    orderBy: { number: "desc" },
    select: { id: true, number: true },
  });
  if (!reset) return;
  const document = await tx.businessDocument.findUniqueOrThrow({
    where: { id },
    select: { command: { select: { reportingPeriodId: true } } },
  });
  const periodId = document.command.reportingPeriodId;
  const period = periodId
    ? await tx.monthClose.findUnique({
        where: { id: periodId },
        select: { number: true },
      })
    : null;
  if ((period?.number ?? 0) < reset.number)
    throw new ConflictException(
      "Операция в закрытом отчёте. Изменяйте фактические остатки нового периода",
    );
}
