import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { TenantContext, AccountNature } from "@billing/shared-types";
import {
  STANDARD_SME_GROUPS,
  STANDARD_SME_ACCOUNTS,
  toMoney,
  applyTransactionToBalance,
} from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { CreateLedgerGroupDto } from "./dto/create-ledger-group.dto";
import { CreateLedgerAccountDto } from "./dto/create-ledger-account.dto";
import { UpdateLedgerAccountDto } from "./dto/update-ledger-account.dto";

@Injectable()
export class LedgersService {
  private readonly logger = new Logger(LedgersService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Idempotent, repeatable seed of standard Indian SME Chart of Accounts
   */
  async seedStandardChartOfAccounts(
    tenant: TenantContext,
  ): Promise<{ seededGroups: number; seededAccounts: number }> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const groupMap = new Map<string, string>(); // name -> id

      // 1. Seed Groups
      let seededGroupsCount = 0;
      for (const tGroup of STANDARD_SME_GROUPS) {
        let parentId: string | null = null;
        if (tGroup.parentName) {
          parentId = groupMap.get(tGroup.parentName) || null;
          if (!parentId) {
            const existingParent = await tx.ledgerGroup.findFirst({
              where: { companyId: tenant.companyId, name: tGroup.parentName },
            });
            if (existingParent) {
              parentId = existingParent.id;
              groupMap.set(tGroup.parentName, existingParent.id);
            }
          }
        }

        const existing = await tx.ledgerGroup.findUnique({
          where: {
            companyId_name: {
              companyId: tenant.companyId,
              name: tGroup.name,
            },
          },
        });

        if (existing) {
          groupMap.set(tGroup.name, existing.id);
        } else {
          const created = await tx.ledgerGroup.create({
            data: {
              organizationId: tenant.organizationId,
              companyId: tenant.companyId,
              name: tGroup.name,
              nameGujarati: tGroup.nameGujarati,
              nature: tGroup.nature as any,
              parentId: parentId || undefined,
              isSystem: true,
            },
          });
          groupMap.set(tGroup.name, created.id);
          seededGroupsCount++;
        }
      }

      // 2. Seed Default Accounts
      let seededAccountsCount = 0;
      for (const tAcc of STANDARD_SME_ACCOUNTS) {
        let groupId = groupMap.get(tAcc.groupName);
        if (!groupId) {
          const grp = await tx.ledgerGroup.findFirst({
            where: { companyId: tenant.companyId, name: tAcc.groupName },
          });
          if (grp) {
            groupId = grp.id;
            groupMap.set(tAcc.groupName, grp.id);
          }
        }

        if (!groupId) {
          continue;
        }

        const existingAcc = await tx.ledgerAccount.findUnique({
          where: {
            companyId_name: {
              companyId: tenant.companyId,
              name: tAcc.name,
            },
          },
        });

        if (!existingAcc) {
          await tx.ledgerAccount.create({
            data: {
              organizationId: tenant.organizationId,
              companyId: tenant.companyId,
              groupId: groupId,
              name: tAcc.name,
              nameGujarati: tAcc.nameGujarati,
              code: tAcc.code,
              isBankLedger: tAcc.isBankLedger ?? false,
              isCashLedger: tAcc.isCashLedger ?? false,
              isTaxLedger: tAcc.isTaxLedger ?? false,
              taxRate: tAcc.taxRate,
              openingBalance: 0.0,
              openingType: tAcc.openingType,
              currentBalance: 0.0,
              isActive: true,
            },
          });
          seededAccountsCount++;
        }
      }

      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
        action: "SEED",
        entityName: "ChartOfAccounts",
        entityId: tenant.companyId,
        newState: { seededGroupsCount, seededAccountsCount },
      });

      return {
        seededGroups: seededGroupsCount,
        seededAccounts: seededAccountsCount,
      };
    });
  }

  /**
   * List all ledger groups for current company
   */
  async listGroups(tenant: TenantContext): Promise<any[]> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return await tx.ledgerGroup.findMany({
        where: { companyId: tenant.companyId },
        include: {
          parent: { select: { id: true, name: true, nature: true } },
          children: { select: { id: true, name: true, nature: true } },
        },
        orderBy: [{ nature: "asc" }, { name: "asc" }],
      });
    });
  }

  /**
   * Create a custom ledger group
   */
  async createGroup(
    dto: CreateLedgerGroupDto,
    tenant: TenantContext,
  ): Promise<any> {
    if (!dto.name || dto.name.trim() === "") {
      throw new BadRequestException("Group name is required.");
    }

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.ledgerGroup.findUnique({
        where: {
          companyId_name: {
            companyId: tenant.companyId,
            name: dto.name.trim(),
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          `Ledger group with name '${dto.name}' already exists in this company.`,
        );
      }

      if (dto.parentId) {
        const parent = await tx.ledgerGroup.findFirst({
          where: { id: dto.parentId, companyId: tenant.companyId },
        });
        if (!parent) {
          throw new NotFoundException(
            `Parent group '${dto.parentId}' not found.`,
          );
        }
      }

      const created = await tx.ledgerGroup.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          name: dto.name.trim(),
          nameGujarati: dto.nameGujarati?.trim(),
          nature: dto.nature as any,
          parentId: dto.parentId || undefined,
          isSystem: false,
        },
      });

      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
        action: "CREATE",
        entityName: "LedgerGroup",
        entityId: created.id,
        newState: created,
      });

      return created;
    });
  }

  /**
   * List and search ledger accounts
   */
  async listAccounts(
    tenant: TenantContext,
    query?: {
      search?: string;
      groupId?: string;
      nature?: AccountNature;
      isActive?: boolean;
      page?: number;
      limit?: number;
    },
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const page = Math.max(1, Number(query?.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query?.limit) || 50));
      const skip = (page - 1) * limit;

      const where: any = { companyId: tenant.companyId };

      if (query?.groupId) {
        where.groupId = query.groupId;
      }

      if (query?.nature) {
        where.group = { nature: query.nature };
      }

      if (query?.isActive !== undefined) {
        where.isActive = String(query.isActive) === "true";
      }

      if (query?.search && query.search.trim() !== "") {
        const s = query.search.trim();
        where.OR = [
          { name: { contains: s, mode: "insensitive" } },
          { nameGujarati: { contains: s, mode: "insensitive" } },
          { code: { contains: s, mode: "insensitive" } },
        ];
      }

      const [data, total] = await Promise.all([
        tx.ledgerAccount.findMany({
          where,
          include: {
            group: { select: { id: true, name: true, nature: true } },
          },
          orderBy: [{ group: { nature: "asc" } }, { name: "asc" }],
          skip,
          take: limit,
        }),
        tx.ledgerAccount.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  /**
   * Get single ledger account by ID
   */
  async getAccountById(id: string, tenant: TenantContext): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const account = await tx.ledgerAccount.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          group: true,
          party: { select: { id: true, name: true, gstin: true, phone: true } },
        },
      });

      if (!account) {
        throw new NotFoundException(`Ledger account '${id}' not found.`);
      }

      return account;
    });
  }

  /**
   * Create a new ledger account
   */
  async createAccount(
    dto: CreateLedgerAccountDto,
    tenant: TenantContext,
  ): Promise<any> {
    if (!dto.name || dto.name.trim() === "") {
      throw new BadRequestException("Account name is required.");
    }
    if (!dto.groupId) {
      throw new BadRequestException("Group ID is required.");
    }

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const group = await tx.ledgerGroup.findFirst({
        where: { id: dto.groupId, companyId: tenant.companyId },
      });
      if (!group) {
        throw new NotFoundException(`Ledger group '${dto.groupId}' not found.`);
      }

      const existing = await tx.ledgerAccount.findUnique({
        where: {
          companyId_name: {
            companyId: tenant.companyId,
            name: dto.name.trim(),
          },
        },
      });
      if (existing) {
        throw new ConflictException(
          `Ledger account with name '${dto.name}' already exists in this company.`,
        );
      }

      const openingBal = toMoney(dto.openingBalance ?? 0);
      const openingType =
        dto.openingType ||
        (group.nature === "ASSET" || group.nature === "EXPENSE" ? "DR" : "CR");
      const currentBal = openingBal;

      const created = await tx.ledgerAccount.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          groupId: dto.groupId,
          name: dto.name.trim(),
          nameGujarati: dto.nameGujarati?.trim(),
          code: dto.code?.trim(),
          partyId: dto.partyId || undefined,
          isPartyLedger: !!dto.partyId,
          isBankLedger: dto.isBankLedger ?? false,
          isCashLedger: dto.isCashLedger ?? false,
          isTaxLedger: dto.isTaxLedger ?? false,
          taxRate: dto.taxRate,
          openingBalance: openingBal.toNumber(),
          openingType,
          currentBalance: currentBal.toNumber(),
          isActive: dto.isActive !== undefined ? dto.isActive : true,
        },
        include: { group: true },
      });

      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
        action: "CREATE",
        entityName: "LedgerAccount",
        entityId: created.id,
        newState: created,
      });

      return created;
    });
  }

  /**
   * Update an existing ledger account
   */
  async updateAccount(
    id: string,
    dto: UpdateLedgerAccountDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const account = await tx.ledgerAccount.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (!account) {
        throw new NotFoundException(`Ledger account '${id}' not found.`);
      }

      if (dto.name && dto.name.trim() !== account.name) {
        const duplicate = await tx.ledgerAccount.findUnique({
          where: {
            companyId_name: {
              companyId: tenant.companyId,
              name: dto.name.trim(),
            },
          },
        });
        if (duplicate) {
          throw new ConflictException(
            `Ledger account with name '${dto.name}' already exists.`,
          );
        }
      }

      if (dto.groupId && dto.groupId !== account.groupId) {
        const group = await tx.ledgerGroup.findFirst({
          where: { id: dto.groupId, companyId: tenant.companyId },
        });
        if (!group) {
          throw new NotFoundException(
            `Target ledger group '${dto.groupId}' not found.`,
          );
        }
      }

      const updated = await tx.ledgerAccount.update({
        where: { id },
        data: {
          name: dto.name ? dto.name.trim() : undefined,
          nameGujarati:
            dto.nameGujarati !== undefined
              ? dto.nameGujarati?.trim()
              : undefined,
          code: dto.code !== undefined ? dto.code?.trim() : undefined,
          groupId: dto.groupId || undefined,
          isActive: dto.isActive !== undefined ? dto.isActive : undefined,
        },
        include: { group: true },
      });

      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
        action: "UPDATE",
        entityName: "LedgerAccount",
        entityId: id,
        previousState: account,
        newState: updated,
      });

      return updated;
    });
  }

  /**
   * Deactivate an existing ledger account (soft-archive)
   */
  async deactivateAccount(id: string, tenant: TenantContext): Promise<any> {
    return await this.updateAccount(id, { isActive: false }, tenant);
  }
}
