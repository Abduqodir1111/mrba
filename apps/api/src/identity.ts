import { ConflictException } from "@nestjs/common";
import { canonical } from "./canonical";
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  Req,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import * as argon2 from "argon2";
import { Database } from "./db";
import type { Request } from "express";
export const PERMISSIONS = [
  "dashboard.read",
  "factory.write",
  "catalog.read",
  "catalog.write",
  "inventory.read",
  "purchase.post",
  "audit.read",
] as const;
export const Allow = (permission: string) =>
  SetMetadata("permission", permission);
export type Actor = { id: string; name: string; permissions: string[] };
export type AuthRequest = Request & { actor: Actor };
class LoginDto {
  @IsString() @MinLength(1) @MaxLength(100) login!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
  @IsUUID() deviceId!: string;
}
class RefreshDto {
  @IsString() @MinLength(40) @MaxLength(200) refreshToken!: string;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
@Injectable()
export class AuthService {
  constructor(
    private db: Database,
    private jwt: JwtService,
  ) {}
  private access(userId: string, sessionId: string) {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId },
      { expiresIn: "10m", issuer: "mrba-api", audience: "mrba-mobile" },
    );
  }
  async login(dto: LoginDto) {
    const user = await this.db.user.findUnique({
      where: { login: dto.login.trim().toLowerCase() },
    });
    if (
      !user ||
      !user.isActive ||
      !(await argon2.verify(user.passwordHash, dto.password))
    )
      throw new UnauthorizedException("Неверный логин или пароль");
    const token = randomBytes(48).toString("base64url");
    const session = await this.db.refreshSession.create({
      data: {
        userId: user.id,
        deviceId: dto.deviceId,
        tokenHash: hash(token),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    return {
      accessToken: await this.access(user.id, session.id),
      refreshToken: token,
    };
  }
  async refresh(token: string) {
    const result = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash(token)}, 0))`;
      const old = await tx.refreshSession.findUnique({
        where: { tokenHash: hash(token) },
        include: { user: true },
      });
      if (!old) return null;
      if (old.revokedAt) {
        await tx.refreshSession.updateMany({
          where: { familyId: old.familyId },
          data: { revokedAt: new Date() },
        });
        return null;
      }
      if (!old.user.isActive || old.expiresAt <= new Date()) return null;
      await tx.refreshSession.update({
        where: { id: old.id },
        data: { revokedAt: new Date() },
      });
      const next = randomBytes(48).toString("base64url");
      const session = await tx.refreshSession.create({
        data: {
          userId: old.userId,
          deviceId: old.deviceId,
          familyId: old.familyId,
          tokenHash: hash(next),
          expiresAt: old.expiresAt,
        },
      });
      return { userId: old.userId, sessionId: session.id, token: next };
    });
    if (!result) throw new UnauthorizedException("Войдите снова");
    return {
      accessToken: await this.access(result.userId, result.sessionId),
      refreshToken: result.token,
    };
  }
  async logout(token: string) {
    const session = await this.db.refreshSession.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (session)
      await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${session.familyId}, 0))`;
        await tx.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
    return { ok: true };
  }
}
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private db: Database,
    private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const request = ctx.switchToHttp().getRequest<AuthRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer "))
      throw new UnauthorizedException();
    let claims: { sub: string; sid: string };
    try {
      claims = await this.jwt.verifyAsync(authorization.slice(7), {
        issuer: "mrba-api",
        audience: "mrba-mobile",
      });
    } catch {
      throw new UnauthorizedException();
    }
    const session = await this.db.refreshSession.findUnique({
      where: { id: claims.sid },
      include: {
        user: {
          include: {
            roles: { include: { role: { include: { permissions: true } } } },
          },
        },
      },
    });
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    )
      throw new UnauthorizedException();
    const permissions = session.user.roles.flatMap((r) =>
      r.role.permissions.map((p) => p.permissionCode),
    );
    const required = this.reflector.getAllAndOverride<string>("permission", [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required && !permissions.includes(required))
      throw new ForbiddenException();
    const commandId = request.headers["idempotency-key"];
    if (typeof commandId === "string" && /^[0-9a-f-]{36}$/i.test(commandId)) {
      const intent = await this.db.commandIntent.findUnique({
        where: { id: commandId },
      });
      if (
        intent &&
        (intent.actorId !== session.userId ||
          intent.route !== request.path.replace(/^\/api\/v1/, "") ||
          JSON.stringify(canonical(intent.payload)) !==
            JSON.stringify(canonical(request.body)))
      )
        throw new ConflictException(
          "Запрос не соответствует сохранённому черновику",
        );
    }
    request.actor = {
      id: session.userId,
      name: session.user.name,
      permissions,
    };
    return true;
  }
}
@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}
  @Post("login") @Throttle({ default: { limit: 10, ttl: 60000 } }) login(
    @Body() dto: LoginDto,
  ) {
    return this.auth.login(dto);
  }
  @Post("refresh") refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }
  @Post("logout") logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }
  @Get("me") @UseGuards(AccessGuard) me(@Req() req: AuthRequest) {
    return req.actor;
  }
}
