export type ReportKettle = { id: string; name: string };

export async function loadKettleReports<T extends { batchCount: number }>(
  equipment: ReportKettle[],
  periodQuery: string,
  read: (path: string) => Promise<T>,
) {
  const reports = await Promise.all(
    [...equipment].sort((a, b) => a.name.localeCompare(b.name, "ru")).map(async kettle => ({
      equipment: kettle,
      report: await read(`/reports/production-period?${periodQuery}&equipmentId=${encodeURIComponent(kettle.id)}`),
    })),
  );
  return reports.filter(({ report }) => report.batchCount > 0);
}
