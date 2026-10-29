import { Module } from "@nestjs/common";
import { PartiesController } from "./parties.controller";
import { NotesController } from "./notes.controller";
import { AppointmentsController } from "./appointments.controller";
import { PartiesService } from "./parties.service";

@Module({
  controllers: [PartiesController, NotesController, AppointmentsController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}
