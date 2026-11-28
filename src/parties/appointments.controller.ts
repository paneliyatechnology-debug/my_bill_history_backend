import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { PartiesService } from "./parties.service";
import { CreateAppointmentDto, UpdateAppointmentDto } from "./dto/note-appointment.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { TenantContext } from "@billing/shared-types";

@Controller("appointments")
export class AppointmentsController {
  constructor(private readonly partiesService: PartiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.partiesService.createAppointment(ctx, dto.partyId, dto);
  }

  @Get()
  async findAll(
    @CurrentTenant() ctx: TenantContext,
    @Query("partyId") partyId?: string,
    @Query("upcoming") upcoming?: string,
  ) {
    return this.partiesService.getAppointments(
      ctx,
      partyId,
      upcoming === "true" || upcoming === "1",
    );
  }

  @Patch(":id")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.partiesService.updateAppointment(ctx, id, dto);
  }

  @Delete(":id")
  async delete(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.partiesService.deleteAppointment(ctx, id);
  }
}
