import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { HealthModule } from "./health/health.module";
import { DatabaseModule } from "./database/database.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { MailModule } from "./mail/mail.module";
import { TenantsModule } from "./tenants/tenants.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { CorrelationIdInterceptor } from "./common/interceptors/correlation-id.interceptor";
import { TenantContextInterceptor } from "./common/interceptors/tenant-context.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

import { UnitsModule } from "./units/units.module";
import { CategoriesModule } from "./categories/categories.module";
import { PartiesModule } from "./parties/parties.module";
import { ItemsModule } from "./items/items.module";
import { BatchesModule } from "./batches/batches.module";
import { HsnModule } from "./hsn/hsn.module";
import { LedgersModule } from "./ledgers/ledgers.module";
import { VouchersModule } from "./vouchers/vouchers.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { PurchasesModule } from "./purchases/purchases.module";
import { ReportsModule } from "./reports/reports.module";
import { ManufacturingModule } from "./manufacturing/manufacturing.module";
import { DistributionModule } from "./distribution/distribution.module";
import { ReconciliationModule } from "./reconciliation/reconciliation.module";
import { GstModule } from "./gst/gst.module";
import { SuperAdminModule } from "./super-admin/super-admin.module";
import { ImportsModule } from "./imports/imports.module";

import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: 60000,
          limit: config.get("NODE_ENV") === "test" ? 10000 : 120,
        },
      ],
    }),
    DatabaseModule,
    AuditModule,
    MailModule,
    AuthModule,
    TenantsModule,
    SuperAdminModule,
    UnitsModule,
    CategoriesModule,
    PartiesModule,
    ItemsModule,
    BatchesModule,
    HsnModule,
    LedgersModule,
    VouchersModule,
    InvoicesModule,
    PurchasesModule,
    ReportsModule,
    ManufacturingModule,
    DistributionModule,
    ReconciliationModule,
    GstModule,
    ImportsModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
