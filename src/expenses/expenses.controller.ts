import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { VouchersService } from "../vouchers/vouchers.service";
import { DatabaseService } from "../database/database.service";

@Controller("expenses")
export class ExpensesController {
  constructor(
    private readonly vouchersService: VouchersService,
    private readonly prisma: DatabaseService,
  ) {}

  @Get()
  async listExpenses(
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 50));
    const skip = (page - 1) * limit;

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = {
        companyId: tenant.companyId,
        voucherType: "PAYMENT",
      };

      if (query?.isCancelled !== undefined) {
        where.isCancelled = String(query.isCancelled) === "true";
      }

      if (query?.search && query.search.trim() !== "") {
        const s = query.search.trim();
        where.OR = [
          { voucherNumber: { contains: s, mode: "insensitive" } },
          { narration: { contains: s, mode: "insensitive" } },
          { referenceNo: { contains: s, mode: "insensitive" } },
        ];
      }

      if (query?.startDate || query?.endDate) {
        where.voucherDate = {};
        if (query.startDate) where.voucherDate.gte = new Date(query.startDate);
        if (query.endDate) where.voucherDate.lte = new Date(query.endDate);
      }

      const [vouchers, total] = await Promise.all([
        tx.voucher.findMany({
          where,
          include: {
            financialYear: { select: { id: true, name: true } },
            journalEntries: {
              include: {
                account: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    group: { select: { id: true, name: true, nature: true } },
                  },
                },
              },
              orderBy: { sequenceOrder: "asc" },
            },
          },
          orderBy: [{ voucherDate: "desc" }, { createdAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.voucher.count({ where }),
      ]);

      const data = vouchers.map((v) => {
        const debitLine = v.journalEntries.find((j) => Number(j.debitAmount) > 0);
        const creditLine = v.journalEntries.find((j) => Number(j.creditAmount) > 0);
        const expenseAccName =
          debitLine?.account?.name || debitLine?.lineNarration || "General Expense";
        const paymentMode =
          creditLine?.account?.name || v.paymentMode || "Cash";

        return {
          id: v.id,
          voucherNumber: v.voucherNumber,
          expenseNumber: v.voucherNumber,
          voucherDate: v.voucherDate,
          expenseDate: v.voucherDate,
          createdAt: v.createdAt,
          totalAmount: Number(v.totalAmount),
          amount: Number(v.totalAmount),
          narration: v.narration,
          referenceNo: v.referenceNo,
          paymentMode,
          party: { name: expenseAccName },
          partyName: expenseAccName,
          category: {
            id: debitLine?.account?.group?.id || null,
            name: debitLine?.account?.group?.name || "Business Expenses",
          },
          expenseAccount: debitLine?.account || null,
          paidFromAccount: creditLine?.account || null,
          journalEntries: v.journalEntries,
          isCancelled: v.isCancelled,
        };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  @Get(":id")
  async getExpense(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.getVoucherById(id, tenant);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async createExpense(
    @Body() dto: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.createExpenseVoucher(dto, tenant);
  }

  @Put(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async updateExpense(
    @Param("id") id: string,
    @Body() dto: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.updateExpenseVoucher(id, dto, tenant);
  }

  @Delete(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async deleteExpense(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.reverseVoucher(
      id,
      { reason: "Expense cancelled/deleted" },
      tenant,
    );
  }
}
