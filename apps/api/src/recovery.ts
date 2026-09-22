import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsObject,
  IsString,
  Matches,
  MaxLength,
  IsOptional,
  IsIn,
  IsInt,
  Min,
} from "class-validator";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Database } from "./db";
import { AccessGuard, Allow, AuthRequest } from "./identity";
import { lock, ensure } from "./factory";
class IntentDto {
  @IsString() @Matches(/^\/[a-z][a-z0-9/-]*$/) @MaxLength(180) route!: string;
  @IsOptional() @IsIn(["DRAFT", "PREPARED"]) status?: "DRAFT" | "PREPARED";
  @IsObject() payload!: Prisma.InputJsonObject;
}
class VersionDto {
  @IsInt() @Min(1) version!: number;
}
class EditDto extends VersionDto {
  @IsObject() payload!: Prisma.InputJsonObject;
}
@Controller("drafts")
@UseGuards(AccessGuard)
@Allow("factory.write")
export class RecoveryController {
  constructor(private db: Database) {}
  @Get() list(@Req() req: AuthRequest) {
    return this.db.commandIntent.findMany({
      where: { actorId: req.actor.id, status: { in: ["DRAFT", "PREPARED"] } },
      orderBy: { updatedAt: "desc" },
    });
  }
  @Post(":id") async prepare(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: IntentDto,
  ) {
    ensure(epoch === process.env.RECOVERY_EPOCH, "SERVER_CONTEXT_CHANGED");
    ensure(
      !/^\/(auth|drafts|commands|users)(\/|$)/.test(dto.route),
      "Неверный адрес операции",
    );
    const hash = createHash("sha256").update(JSON.stringify(dto)).digest("hex");
    return this.db.$transaction(async (tx) => {
      await lock(tx, id);
      const old = await tx.commandIntent.findUnique({ where: { id } });
      if (old) {
        ensure(
          old.actorId === req.actor.id &&
            old.payloadHash === hash &&
            old.epoch === epoch,
          "Черновик уже подготовлен с другими данными",
        );
        return { id, status: old.status };
      }
      ensure(
        !(await tx.commandReceipt.findUnique({ where: { commandId: id } })),
        "Операция уже завершена",
      );
      await tx.commandIntent.create({
        data: {
          id,
          actorId: req.actor.id,
          route: dto.route,
          payload: dto.payload,
          payloadHash: hash,
          epoch,
          status: dto.status ?? "PREPARED",
        },
      });
      return { id, status: dto.status ?? "PREPARED" };
    });
  }
  @Post(":id/edit") async edit(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: EditDto,
  ) {
    ensure(epoch === process.env.RECOVERY_EPOCH, "SERVER_CONTEXT_CHANGED");
    return this.db.$transaction(async (tx) => {
      await lock(tx, id);
      const d = await tx.commandIntent.findUniqueOrThrow({ where: { id } });
      ensure(
        d.actorId === req.actor.id &&
          d.epoch === epoch &&
          d.status === "DRAFT" &&
          d.version === dto.version,
        "Черновик изменён или уже отправлен",
      );
      const payloadHash = createHash("sha256")
        .update(
          JSON.stringify({
            route: d.route,
            payload: dto.payload,
            status: "DRAFT",
          }),
        )
        .digest("hex");
      return tx.commandIntent.update({
        where: { id },
        data: { payload: dto.payload, payloadHash, version: { increment: 1 } },
      });
    });
  }
  @Post(":id/prepare") async freeze(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("x-recovery-epoch") epoch: string,
    @Body() dto: VersionDto,
  ) {
    ensure(epoch === process.env.RECOVERY_EPOCH, "SERVER_CONTEXT_CHANGED");
    return this.db.$transaction(async (tx) => {
      await lock(tx, id);
      const d = await tx.commandIntent.findUniqueOrThrow({ where: { id } });
      ensure(
        d.actorId === req.actor.id && d.epoch === epoch,
        "Чужой или устаревший черновик",
      );
      if (d.status === "PREPARED") return d;
      ensure(
        d.status === "DRAFT" && d.version === dto.version,
        "Черновик изменён",
      );
      return tx.commandIntent.update({
        where: { id },
        data: { status: "PREPARED", version: { increment: 1 } },
      });
    });
  }
  @Get(":id") async read(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const r = await this.db.commandIntent.findFirst({
      where: { id, actorId: req.actor.id },
    });
    if (!r) throw new NotFoundException("Черновик не найден");
    return r;
  }
  @Post(":id/cancel") async cancel(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("x-recovery-epoch") epoch: string,
  ) {
    ensure(epoch === process.env.RECOVERY_EPOCH, "SERVER_CONTEXT_CHANGED");
    return this.db.$transaction(async (tx) => {
      await lock(tx, id);
      const receipt = await tx.commandReceipt.findUnique({
        where: { commandId: id },
      });
      if (receipt) {
        ensure(receipt.actorId === req.actor.id, "Чужая операция");
        return receipt;
      }
      const intent = await tx.commandIntent.findUnique({ where: { id } });
      if (intent) ensure(intent.actorId === req.actor.id, "Чужой черновик");
      const result = { id, status: "CANCELLED" };
      const r = await tx.commandReceipt.create({
        data: {
          commandId: id,
          actorId: req.actor.id,
          type: "CANCELLED",
          payloadHash: "CANCELLED",
          result,
        },
      });
      if (intent)
        await tx.commandIntent.update({
          where: { id },
          data: { status: "CANCELLED" },
        });
      await tx.auditLog.create({
        data: {
          actorId: req.actor.id,
          commandId: id,
          action: "COMMAND_CANCEL",
          entityId: id,
          snapshot: result,
        },
      });
      return r;
    });
  }
}
