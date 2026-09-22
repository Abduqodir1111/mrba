import "reflect-metadata";
import * as argon2 from "argon2";
import { Database } from "./db";
import { PERMISSIONS } from "./identity";
async function seed() {
  if (
    !process.env.OWNER_LOGIN ||
    (process.env.OWNER_PASSWORD?.length ?? 0) < 14
  )
    throw new Error(
      "Set OWNER_LOGIN and OWNER_PASSWORD (at least 14 characters)",
    );
  const db = new Database();
  try {
    await db.$transaction(async (tx) => {
      const role = await tx.role.upsert({
        where: { code: "OWNER" },
        create: { code: "OWNER", name: "Владелец" },
        update: {},
      });
      for (const code of PERMISSIONS) {
        await tx.permission.upsert({
          where: { code },
          create: { code },
          update: {},
        });
        await tx.rolePermission.upsert({
          where: {
            roleId_permissionCode: { roleId: role.id, permissionCode: code },
          },
          create: { roleId: role.id, permissionCode: code },
          update: {},
        });
      }
      const user = await tx.user.upsert({
        where: { login: process.env.OWNER_LOGIN!.toLowerCase() },
        create: {
          login: process.env.OWNER_LOGIN!.toLowerCase(),
          name: "Владелец",
          passwordHash: await argon2.hash(process.env.OWNER_PASSWORD!, {
            type: argon2.argon2id,
          }),
        },
        update: {},
      });
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        create: { userId: user.id, roleId: role.id },
        update: {},
      });
      const site = await tx.site.upsert({
        where: { id: "7daaefaa-13b4-47e2-852d-5d076e64b07c" },
        create: {
          id: "7daaefaa-13b4-47e2-852d-5d076e64b07c",
          name: "MRBA",
          city: "Каттакурган",
          region: "Самаркандская область",
        },
        update: {},
      });
      for (const [name, direction] of [
        ["Латунный котёл", "BRASS"],
        ["Медный котёл", "COPPER"],
      ])
        await tx.equipment.upsert({
          where: { siteId_name: { siteId: site.id, name } },
          create: { siteId: site.id, name, direction },
          update: {},
        });
      const warehouse = await tx.warehouse.upsert({
        where: { siteId_name: { siteId: site.id, name: "Склад сырья" } },
        create: { siteId: site.id, name: "Склад сырья" },
        update: {},
      });
      await tx.stockLocation.upsert({
        where: {
          warehouseId_name: {
            warehouseId: warehouse.id,
            name: "Основной склад",
          },
        },
        create: { warehouseId: warehouse.id, name: "Основной склад" },
        update: {},
      });
      const salesWarehouse = await tx.warehouse.upsert({
        where: { siteId_name: { siteId: site.id, name: "Склад для продажи" } },
        create: { siteId: site.id, name: "Склад для продажи" },
        update: {},
      });
      await tx.stockLocation.upsert({
        where: {
          warehouseId_name: {
            warehouseId: salesWarehouse.id,
            name: "Склад для продажи",
          },
        },
        create: { warehouseId: salesWarehouse.id, name: "Склад для продажи" },
        update: {},
      });
      for (const [code, name, startHour, endHour, endDayOffset] of [
        ["DAY", "Дневная смена", 8, 20, 0],
        ["NIGHT", "Ночная смена", 20, 8, 1],
      ] as const)
        await tx.shiftTemplate.upsert({
          where: { siteId_code: { siteId: site.id, code } },
          create: {
            siteId: site.id,
            code,
            name,
            startHour,
            endHour,
            endDayOffset,
          },
          update: {},
        });
    });
    console.log(
      "Owner, permissions, factory and two shifts initialized. No business transactions seeded.",
    );
  } finally {
    await db.$disconnect();
  }
}
void seed();
