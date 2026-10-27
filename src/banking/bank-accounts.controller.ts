import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { DatabaseService } from "../database/database.service";
import { LedgersService } from "../ledgers/ledgers.service";

@Controller(["bank-accounts", "banking/accounts"])
export class BankAccountsController {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly ledgersService: LedgersService,
  ) {}

  @Get()
  async listBankAccounts(@CurrentTenant() tenant: TenantContext) {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Fetch bank/cash ledger accounts
      const accounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          OR: [
            { isBankLedger: true },
            { isCashLedger: true },
            {
              group: {
                name: {
                  in: [
                    "Bank Accounts",
                    "Bank OD A/c",
                    "Bank OD/OCC",
                    "Cash-in-hand",
                  ],
                },
              },
            },
          ],
        },
        include: {
          group: { select: { id: true, name: true, nature: true } },
        },
        orderBy: [{ isBankLedger: "desc" }, { name: "asc" }],
      });

      // 2. Fetch company bank details for fallback/metadata
      const company = await tx.company.findUnique({
        where: { id: tenant.companyId },
        select: {
          bankName: true,
          bankAccountNo: true,
          bankIfsc: true,
          bankBranch: true,
          bankAccountBarcode: true,
        },
      });

      const data = accounts.map((acc) => ({
        id: acc.id,
        name: acc.name,
        nameGujarati: acc.nameGujarati,
        code: acc.code,
        bankAccountNo: company?.bankAccountNo || acc.code || "",
        bankName: company?.bankName || acc.name,
        bankIfsc: company?.bankIfsc || "",
        bankBranch: company?.bankBranch || "",
        currentBalance: Number(acc.currentBalance),
        openingBalance: Number(acc.openingBalance),
        openingType: acc.openingType,
        isBankLedger: acc.isBankLedger,
        isCashLedger: acc.isCashLedger,
        group: acc.group,
      }));

      return {
        data,
        total: data.length,
        companyBank: company || null,
      };
    });
  }

  @Get(":id")
  async getBankAccount(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.ledgersService.getAccountById(id, tenant);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async createBankAccount(
    @Body() dto: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      let bankGroup = await tx.ledgerGroup.findFirst({
        where: {
          companyId: tenant.companyId,
          name: "Bank Accounts",
        },
      });
      if (!bankGroup) {
        bankGroup = await tx.ledgerGroup.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            name: "Bank Accounts",
            nature: "ASSET" as any,
            isSystem: true,
          },
        });
      }

      return await this.ledgersService.createAccount(
        {
          name: dto.name || dto.bankName || "Bank Account",
          groupId: bankGroup.id,
          openingBalance: dto.openingBalance || 0,
          openingType: dto.openingType || "DR",
          isBankLedger: true,
          code: dto.bankAccountNo || dto.code,
        },
        tenant,
      );
    });
  }

  @Put(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async updateBankAccount(
    @Param("id") id: string,
    @Body() dto: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.ledgersService.updateAccount(id, dto, tenant);
  }

  @Delete(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async deleteBankAccount(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.ledgersService.deactivateAccount(id, tenant);
  }
}
