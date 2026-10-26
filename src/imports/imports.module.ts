import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";
import { ImportSchemaRegistry } from "./import-schema.registry";
import { FileParserService } from "./file-parser.service";
import { TemplateGeneratorService } from "./template-generator.service";
import { ImportValidatorService } from "./import-validator.service";
import { ImportExecutorService } from "./import-executor.service";
import { ErrorReporterService } from "./error-reporter.service";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    ImportSchemaRegistry,
    FileParserService,
    TemplateGeneratorService,
    ImportValidatorService,
    ImportExecutorService,
    ErrorReporterService,
  ],
  exports: [ImportsService, ImportSchemaRegistry],
})
export class ImportsModule {}
