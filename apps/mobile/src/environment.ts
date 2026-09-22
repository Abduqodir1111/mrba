export const DEMO_LOGIN = "review@mrba.uz";
export function apiEnvironment(login: string): "demo" | "production" {
  return login.trim().toLowerCase() === DEMO_LOGIN ? "demo" : "production";
}
export function environmentUrl(base: string, environment: string) {
  return environment === "demo" ? base.replace(/\/api\/v1\/?$/, "/demo/api/v1") : base;
}
