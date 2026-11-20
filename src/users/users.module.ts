import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { UsersService } from "./users.service";
import {
  UsersController,
  RolesController,
  ApprovalsController,
} from "./users.controller";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    forwardRef(() => InvoicesModule),
  ],
  controllers: [
    UsersController,
    RolesController,
    ApprovalsController,
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
