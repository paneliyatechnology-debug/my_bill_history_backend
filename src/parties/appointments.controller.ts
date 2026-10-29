import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { PartiesService } from "./parties.service";
import { CreateAppointmentDto } from "./dto/note-appointment.dto";
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
  ) {
    return this.partiesService.getAppointments(ctx, partyId);
  }

  @Delete(":id")
  async delete(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.partiesService.deleteAppointment(ctx, id);
  }
}
