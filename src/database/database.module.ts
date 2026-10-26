import { Global, Module } from "@nestjs/common";
import { DatabaseService } from "./database.service";
import { SupportSessionRegistry } from "../super-admin/support-session.registry";

@Global()
@Module({
  providers: [DatabaseService, SupportSessionRegistry],
  exports: [DatabaseService, SupportSessionRegistry],
})
export class DatabaseModule {}
