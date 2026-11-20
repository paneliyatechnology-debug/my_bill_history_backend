import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { PartiesService } from "./parties.service";
import { CreatePartyDto } from "./dto/create-party.dto";
import { UpdatePartyDto, QueryPartiesDto } from "./dto/update-party.dto";
import {
  CreateNoteDto,
  CreateAppointmentDto,
} from "./dto/note-appointment.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller(["parties", "masters/parties"])
export class PartiesController {
  constructor(private readonly partiesService: PartiesService) {}

  @RequirePermissions({ module: "parties", action: "create" })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreatePartyDto,
  ) {
    return this.partiesService.create(ctx, dto);
  }

  @RequirePermissions({ module: "parties", action: "view" })
  @Get()
  async findAll(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QueryPartiesDto,
  ) {
    return this.partiesService.findAll(ctx, query);
  }

  @RequirePermissions({ module: "parties", action: "view" })
  @Get("lookup/gstin/:gstin")
  async lookupGstin(
    @CurrentTenant() ctx: TenantContext,
    @Param("gstin") gstin: string,
  ) {
    return this.partiesService.lookupGstin(ctx, gstin);
  }

  // -------------------------------------------------------------
  // NOTES DIRECT ENDPOINTS
  // -------------------------------------------------------------
  @RequirePermissions({ module: "parties", action: "create" })
  @Post("notes")
  @HttpCode(HttpStatus.CREATED)
  async createGeneralNote(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateNoteDto,
  ) {
    return this.partiesService.createNote(ctx, dto.partyId, dto);
  }

  @RequirePermissions({ module: "parties", action: "view" })
  @Get("notes")
  async getAllNotes(
    @CurrentTenant() ctx: TenantContext,
    @Query("partyId") partyId?: string,
  ) {
    return this.partiesService.getNotes(ctx, partyId);
  }

  @RequirePermissions({ module: "parties", action: "delete" })
  @Delete("notes/:noteId")
  async deleteNote(
    @CurrentTenant() ctx: TenantContext,
    @Param("noteId") noteId: string,
  ) {
    return this.partiesService.deleteNote(ctx, noteId);
  }

  // -------------------------------------------------------------
  // APPOINTMENTS DIRECT ENDPOINTS
  // -------------------------------------------------------------
  @RequirePermissions({ module: "parties", action: "create" })
  @Post("appointments")
  @HttpCode(HttpStatus.CREATED)
  async createGeneralAppointment(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.partiesService.createAppointment(ctx, dto.partyId, dto);
  }

  @RequirePermissions({ module: "parties", action: "view" })
  @Get("appointments")
  async getAllAppointments(
    @CurrentTenant() ctx: TenantContext,
    @Query("partyId") partyId?: string,
  ) {
    return this.partiesService.getAppointments(ctx, partyId);
  }

  @RequirePermissions({ module: "parties", action: "delete" })
  @Delete("appointments/:appointmentId")
  async deleteAppointment(
    @CurrentTenant() ctx: TenantContext,
    @Param("appointmentId") appointmentId: string,
  ) {
    return this.partiesService.deleteAppointment(ctx, appointmentId);
  }

  @RequirePermissions({ module: "parties", action: "view" })
  @Get(":id")
  async findOne(@CurrentTenant() ctx: TenantContext, @Param("id") id: string) {
    return this.partiesService.findOne(ctx, id);
  }

  // -------------------------------------------------------------
  // PARTY-SPECIFIC NOTES & APPOINTMENTS
  // -------------------------------------------------------------
  @RequirePermissions({ module: "parties", action: "create" })
  @Post(":id/notes")
  @HttpCode(HttpStatus.CREATED)
  async createPartyNote(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") partyId: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.partiesService.createNote(ctx, partyId, dto);
  }

  @RequirePermissions({ module: "parties", action: "view" })
  @Get(":id/notes")
  async getPartyNotes(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") partyId: string,
  ) {
    return this.partiesService.getNotes(ctx, partyId);
  }

  @RequirePermissions({ module: "parties", action: "create" })
  @Post(":id/appointments")
  @HttpCode(HttpStatus.CREATED)
  async createPartyAppointment(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") partyId: string,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.partiesService.createAppointment(ctx, partyId, dto);
  }

  @RequirePermissions({ module: "parties", action: "view" })
  @Get(":id/appointments")
  async getPartyAppointments(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") partyId: string,
  ) {
    return this.partiesService.getAppointments(ctx, partyId);
  }

  @RequirePermissions({ module: "parties", action: "edit" })
  @Put(":id")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: UpdatePartyDto,
  ) {
    return this.partiesService.update(ctx, id, dto);
  }

  @RequirePermissions({ module: "parties", action: "edit" })
  @Patch(":id/archive")
  async archive(@CurrentTenant() ctx: TenantContext, @Param("id") id: string) {
    return this.partiesService.archive(ctx, id);
  }

  @RequirePermissions({ module: "parties", action: "delete" })
  @Post("bulk-delete")
  @HttpCode(HttpStatus.OK)
  async bulkDelete(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: { ids: string[]; force?: boolean },
  ) {
    return this.partiesService.bulkDelete(ctx, body.ids, Boolean(body.force));
  }

  @RequirePermissions({ module: "parties", action: "delete" })
  @Delete(":id")
  async delete(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Query("force") force?: string,
  ) {
    return this.partiesService.delete(ctx, id, force === "true");
  }
}
