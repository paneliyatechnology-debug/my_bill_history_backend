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
import { CreateNoteDto } from "./dto/note-appointment.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { TenantContext } from "@billing/shared-types";

@Controller("notes")
export class NotesController {
  constructor(private readonly partiesService: PartiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateNoteDto,
  ) {
    return this.partiesService.createNote(ctx, dto.partyId, dto);
  }

  @Get()
  async findAll(
    @CurrentTenant() ctx: TenantContext,
    @Query("partyId") partyId?: string,
  ) {
    return this.partiesService.getNotes(ctx, partyId);
  }

  @Delete(":id")
  async delete(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.partiesService.deleteNote(ctx, id);
  }
}
