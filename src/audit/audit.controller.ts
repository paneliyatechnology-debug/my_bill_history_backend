import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuditService, ActivityQueryDto } from "./audit.service";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { TenantContext } from "../shared-types";

@Controller("activity-logs")
@UseGuards(PermissionsGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Get paginated activity logs with field-level diffs, search, and strict multi-tenant boundary.
   */
  @Get()
  async getActivityLogs(
    @CurrentTenant() ctx: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ActivityQueryDto,
  ) {
    return this.auditService.getActivities(ctx, query, user);
  }

  /**
   * Get single activity event with full details and state diffs.
   */
  @Get(":id")
  async getActivityById(
    @CurrentTenant() ctx: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.auditService.getActivityById(ctx, id, user);
  }
}
