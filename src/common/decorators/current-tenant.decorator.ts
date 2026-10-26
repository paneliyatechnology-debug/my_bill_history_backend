import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { TENANT_CONTEXT_KEY } from "../interceptors/tenant-context.interceptor";

export const CurrentTenant = createParamDecorator(
  (data: keyof TenantContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const tenant = request[TENANT_CONTEXT_KEY] as TenantContext;
    return data && tenant ? tenant[data] : tenant;
  },
);
