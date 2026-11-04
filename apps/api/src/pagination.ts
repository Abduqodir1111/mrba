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
  const ordering = Array.isArray(args.orderBy) ? [...args.orderBy] : [args.orderBy ?? { id: "desc" }];
  if (!ordering.some((entry: any) => "id" in entry)) ordering.push({ id: "desc" });
  const fields = ordering.map((entry: any) => {
    const field = Object.keys(entry)[0];
    const nested = typeof entry[field] === "object" ? Object.keys(entry[field])[0] : null;
    return { field, nested, direction: nested ? entry[field][nested] : entry[field] };
  });
  let boundary: any = {};
  if (q.cursor) {
    const include: any = {};
    for (const f of fields) if (f.nested) include[f.field] = { select: { ...include[f.field]?.select, [f.nested]: true } };
    const cursor = await model.findUnique({ where: { id: q.cursor }, ...(Object.keys(include).length ? { include } : {}) });
    if (!cursor) throw new ConflictException("Позиция списка недоступна. Обновите список.");
    const condition = (f: any, comparison?: string) => {
      const value = f.nested ? cursor[f.field][f.nested] : cursor[f.field];
      const filter = comparison ? { [comparison]: value } : value;
      return f.nested ? { [f.field]: { [f.nested]: filter } } : { [f.field]: filter };
    };
    boundary = { OR: fields.map((f: any, i: number) => ({ AND: [
      ...fields.slice(0, i).map((previous: any) => condition(previous)),
      condition(f, f.direction === "asc" ? "gt" : "lt"),
    ] })) };
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
    orderBy: ordering,
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
