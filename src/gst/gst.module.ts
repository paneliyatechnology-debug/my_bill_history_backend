import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { GstController } from "./gst.controller";
import { GstPortalService } from "./gst-portal.service";
import { GstDocumentsService } from "./gst-documents.service";
import { Gstr2bService } from "./gstr2b.service";
import { GstVerificationService } from "./gst-verification.service";

@Module({
  imports: [DatabaseModule],
  controllers: [GstController],
  providers: [
    Gstr2bService,
    GstPortalService,
    GstDocumentsService,
    GstVerificationService,
  ],
  exports: [
    Gstr2bService,
    GstPortalService,
    GstDocumentsService,
    GstVerificationService,
  ],
})
export class GstModule {}
