import { ConflictException } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
} from "class-validator";
export class PageQuery {
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
}
// Preserve a list's name/time ordering, with immutable UUID as the tie-breaker.
export async function page(
  model: any,
  args: any,
  q: PageQuery,
  searchField?: string,
) {
  const limit = q.limit ?? 50;
  const primary = Array.isArray(args.orderBy)
    ? args.orderBy[0]
    : (args.orderBy ?? { id: "desc" });
  const field = Object.keys(primary)[0];
  const relation = typeof primary[field] === "object";
  const nested = relation ? Object.keys(primary[field])[0] : null;
  const direction = relation ? primary[field][nested!] : primary[field];
  const comparison = direction === "asc" ? "gt" : "lt";
  let boundary: any = {};
  if (q.cursor) {
    if (field === "id") boundary = { id: { [comparison]: q.cursor } };
    else {
      const cursor = await model.findUnique({
        where: { id: q.cursor },
        ...(relation
          ? { include: { [field]: { select: { [nested!]: true } } } }
          : {}),
      });
      if (!cursor)
        throw new ConflictException(
          "Позиция списка недоступна. Обновите список.",
        );
      const value = relation ? cursor[field][nested!] : cursor[field];
      boundary = {
        OR: [
          relation
            ? { [field]: { [nested!]: { [comparison]: value } } }
            : { [field]: { [comparison]: value } },
          {
            ...(relation
              ? { [field]: { [nested!]: value } }
              : { [field]: value }),
            id: { lt: q.cursor },
          },
        ],
      };
    }
  }
  const where = {
    AND: [
      args.where ?? {},
      boundary,
      ...(q.search && searchField
        ? [{ [searchField]: { contains: q.search, mode: "insensitive" } }]
        : []),
    ],
  };
  const records = await model.findMany({
    ...args,
    where,
    take: limit + 1,
    orderBy: field === "id" ? primary : [primary, { id: "desc" }],
  });
  return {
    items: records.slice(0, limit),
    nextCursor: records.length > limit ? records[limit - 1].id : null,
  };
}
export class StockPageQuery {
  @IsOptional() @Matches(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
}
