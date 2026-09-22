import "reflect-metadata";
import {
  Catch,
  BadRequestException,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
  Logger,
  Module,
  ValidationPipe,
} from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { Prisma } from "@prisma/client";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { AdminController } from "./admin";
import { CorrectionsController } from "./corrections";
import { ReportsController } from "./reports";
import { RecoveryController } from "./recovery";
import { SalesController } from "./sales";
import { FactoryService, FactoryController } from "./factory";
import { Database } from "./db";
import { AccessGuard, AuthService, AuthController } from "./identity";
import {
  OperationsService,
  OperationsController,
  HealthController,
} from "./operations";
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    let status = error instanceof HttpException ? error.getStatus() : 500;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      status = 409;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      status = 404;
    const details =
      error instanceof HttpException ? error.getResponse() : undefined;
    const message =
      status === 500
        ? "Внутренняя ошибка сервера"
        : status === 409 && !details
          ? "Такая запись уже существует"
          : typeof details === "string"
            ? details
            : (details as any)?.message;
    const correlationId = randomUUID();
    if (status >= 500)
      Logger.error(
        JSON.stringify({
          correlationId,
          code: "INTERNAL_ERROR",
          errorType: error instanceof Error ? error.name : "unknown",
        }),
      );
    response.status(status).json({
      code: `HTTP_${status}`,
      message,
      correlationId,
      retryable: status >= 500,
    });
  }
}
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: process.env.JWT_SECRET }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 90 }]),
  ],
  controllers: [
    AuthController,
    OperationsController,
    HealthController,
    FactoryController,
    SalesController,
    RecoveryController,
    ReportsController,
    CorrectionsController,
    AdminController,
  ],
  providers: [
    Database,
    AuthService,
    AccessGuard,
    OperationsService,
    FactoryService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
export async function createApp() {
  if (
    !process.env.DATABASE_URL ||
    !process.env.RECOVERY_EPOCH ||
    (process.env.JWT_SECRET?.length ?? 0) < 32
  )
    throw new Error(
      "DATABASE_URL, RECOVERY_EPOCH and a strong JWT_SECRET are required",
    );
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
    logger: ["error", "warn", "log"],
  });
  if (process.env.NODE_ENV === "production")
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(helmet());
  app.use((req: any, res: any, next: () => void) => {
    const started = Date.now();
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => {
      if (process.env.NODE_ENV === "production")
        Logger.log(
          JSON.stringify({
            requestId,
            method: req.method,
            route: req.route?.path ?? "unmatched",
            status: res.statusCode,
            durationMs: Date.now() - started,
          }),
        );
    });
    next();
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const labels: Record<string, string> = {
          quantityKg: "Вес",
          quantity: "Вес",
          countedKg: "Фактический остаток",
          unitPricePerKg: "Цена за кг",
          name: "Название",
          supplierId: "Поставщик",
          customerId: "Клиент",
          itemId: "Позиция",
          materialId: "Материал",
          locationId: "Зона склада",
          destinationId: "Зона назначения",
          lotId: "Партия",
          currency: "Валюта",
          equipmentId: "Оборудование",
          version: "Версия записи",
          outputs: "Результаты плавки",
          lines: "Позиции документа",
          from: "Начало периода",
          to: "Конец периода",
          password: "Пароль",
          login: "Логин",
          reason: "Причина",
          vehicleNumber: "Госномер машины",
        };
        const messages: string[] = [];
        const walk = (list: any[]) => {
          for (const e of list) {
            if (e.constraints)
              messages.push(
                `Проверьте поле «${labels[e.property] ?? "Данные формы"}»`,
              );
            if (e.children?.length) walk(e.children);
          }
        };
        walk(errors);
        return new BadRequestException([...new Set(messages)]);
      },
    }),
  );
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  return app;
}
