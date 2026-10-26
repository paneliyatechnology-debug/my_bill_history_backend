import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { BatchesService } from "./batches.service";
import { CreateBatchDto, QueryBatchesDto } from "./dto/create-batch.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("batches")
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateBatchDto,
  ) {
    return this.batchesService.create(ctx, dto);
  }

  @Get()
  async findAll(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QueryBatchesDto,
  ) {
    return this.batchesService.findAll(ctx, query);
  }

  @Get(":id")
  async findOne(@CurrentTenant() ctx: TenantContext, @Param("id") id: string) {
    return this.batchesService.findOne(ctx, id);
  }
}
