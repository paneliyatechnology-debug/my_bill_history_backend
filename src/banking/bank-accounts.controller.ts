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
        select: {
          id: true,
          name: true,
          nameGujarati: true,
          code: true,
          currentBalance: true,
          openingBalance: true,
          openingType: true,
          isBankLedger: true,
          isCashLedger: true,
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

  @Get(":id/reconciliation")
  async getBankReconciliation(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const account = await tx.ledgerAccount.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (!account) {
        return { account: null, entries: [], summary: { bookBalance: 0, reconciledBalance: 0, unreconciledAmount: 0 } };
      }

      const entries = await tx.journalEntry.findMany({
        where: {
          accountId: id,
          voucher: { companyId: tenant.companyId },
        },
        include: {
          voucher: {
            select: {
              id: true,
              voucherNumber: true,
              voucherType: true,
              voucherDate: true,
              narration: true,
            },
          },
        },
        orderBy: { voucher: { voucherDate: "desc" } },
        take: 250,
      });

      const entryIds = entries.map((e) => e.id);
      const logs = entryIds.length
        ? await tx.auditLog.findMany({
            where: {
              companyId: tenant.companyId,
              entityName: "BankReconciliation",
              entityId: { in: entryIds },
            },
            orderBy: { createdAt: "desc" },
          })
        : [];

      const clearanceMap = new Map<string, { cleared: boolean; clearanceDate: string | null }>();
      for (const log of logs) {
        if (!clearanceMap.has(log.entityId)) {
          const state: any = log.newState || {};
          clearanceMap.set(log.entityId, {
            cleared: Boolean(state.cleared),
            clearanceDate: state.clearanceDate || null,
          });
        }
      }

      const mapped = entries.map((e) => {
        const brs = clearanceMap.get(e.id);
        const net = Number(e.debitAmount || 0) - Number(e.creditAmount || 0);
        return {
          id: e.id,
          voucherId: e.voucherId,
          voucherNumber: e.voucher.voucherNumber,
          voucherType: e.voucher.voucherType,
          voucherDate: e.voucher.voucherDate,
          narration: e.voucher.narration || "",
          debitAmount: Number(e.debitAmount || 0),
          creditAmount: Number(e.creditAmount || 0),
          netAmount: net,
          cleared: brs?.cleared ?? false,
          clearanceDate: brs?.clearanceDate ?? null,
        };
      });

      const bookBalance = Number(account.currentBalance || 0);
      const unreconciledAmount = mapped
        .filter((m) => !m.cleared)
        .reduce((sum, m) => sum + m.netAmount, 0);
      const reconciledBalance = bookBalance - unreconciledAmount;

      return {
        account: {
          id: account.id,
          name: account.name,
          bookBalance,
        },
        entries: mapped,
        summary: {
          bookBalance,
          reconciledBalance,
          unreconciledAmount,
        },
      };
    });
  }

  @Post(":id/reconciliation")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async markBankReconciliation(
    @Param("id") id: string,
    @Body() body: { entryId: string; cleared: boolean; clearanceDate?: string },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
          action: body.cleared ? "BRS_CLEAR" : "BRS_UNCLEAR",
          entityName: "BankReconciliation",
          entityId: body.entryId,
          recordHash: `BRS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          newState: {
            bankLedgerId: id,
            cleared: Boolean(body.cleared),
            clearanceDate: body.cleared ? body.clearanceDate || new Date().toISOString().split("T")[0] : null,
          },
        },
      });
      return { success: true };
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
