import { Injectable, Logger } from "@nestjs/common";
import { Subject, Observable, merge, interval } from "rxjs";
import { filter, map } from "rxjs/operators";

export type SessionCondition =
  | "TENANT_SUSPENDED"
  | "TENANT_ACTIVATED"
  | "SESSION_REVOKED"
  | "SUBSCRIPTION_EXPIRED"
  | "SUBSCRIPTION_ACTIVE"
  | "PING";

export interface SessionEventPayload {
  type: SessionCondition;
  condition?: SessionCondition;
  tenantId?: string;
  userId?: string;
  organizationId?: string;
  message?: string;
  messageGujarati?: string;
  timestamp?: string;
  subscriptionEnds?: string | null;
  daysRemaining?: number;
  tier?: string;
  isExpired?: boolean;
  isSuspended?: boolean;
}

@Injectable()
export class SessionEventsService {
  private readonly logger = new Logger(SessionEventsService.name);
  private readonly events$ = new Subject<SessionEventPayload>();

  emit(event: SessionEventPayload) {
    this.logger.log(
      `Broadcasting session event: ${event.type} for tenant: ${event.tenantId || "all"}`,
    );
    this.events$.next({
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    });
  }

  emitTenantSuspended(tenantId: string, organizationId?: string) {
    this.emit({
      type: "TENANT_SUSPENDED",
      condition: "TENANT_SUSPENDED",
      tenantId,
      organizationId,
      isSuspended: true,
      message:
        "Your organization account has been suspended by the platform administrator.",
      messageGujarati:
        "તમારું ટેનન્ટ સુપરએડમિન દ્વારા સસ્પેન્ડ કરવામાં આવ્યું છે.",
    });
  }

  emitTenantActivated(tenantId: string, organizationId?: string) {
    this.emit({
      type: "TENANT_ACTIVATED",
      condition: "TENANT_ACTIVATED",
      tenantId,
      organizationId,
      isSuspended: false,
      message: "Your organization account has been activated.",
      messageGujarati: "તમારું ટેનન્ટ સક્રિય કરવામાં આવ્યું છે.",
    });
  }

  /**
   * One event for the open billing session.
   * Suspended -> the browser logs out with this reason.
   * Licence ended -> the browser opens the subscription popup.
   * Licence renewed -> the browser closes that popup and stores the new dates.
   */
  emitAccessState(input: {
    tenantId: string;
    organizationId?: string;
    isSuspended: boolean;
    subscriptionEnds?: Date | string | null;
    tier?: string;
  }) {
    if (input.isSuspended) {
      this.emitTenantSuspended(input.tenantId, input.organizationId);
      return;
    }

    const ends = input.subscriptionEnds ? new Date(input.subscriptionEnds) : null;
    const endsMs = ends && !Number.isNaN(ends.getTime()) ? ends.getTime() : null;
    const isExpired = endsMs !== null && endsMs < Date.now();
    const daysRemaining =
      endsMs === null ? 0 : Math.ceil((endsMs - Date.now()) / (1000 * 60 * 60 * 24));
    const condition: SessionCondition = isExpired
      ? "SUBSCRIPTION_EXPIRED"
      : "SUBSCRIPTION_ACTIVE";

    this.emit({
      type: condition,
      condition,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      isSuspended: false,
      isExpired,
      subscriptionEnds: ends ? ends.toISOString() : null,
      daysRemaining,
      tier: input.tier,
      message: isExpired
        ? "Your subscription has ended. Renew the plan to continue billing."
        : "Your subscription is active.",
      messageGujarati: isExpired
        ? "તમારું સબ્સ્ક્રિપ્શન પૂરું થઈ ગયું છે. બિલિંગ ચાલુ રાખવા પ્લાન રિન્યૂ કરો."
        : "તમારું સબ્સ્ક્રિપ્શન સક્રિય છે.",
    });
  }

  subscribeForTenant(
    tenantId?: string,
    organizationId?: string,
    subscriber?: { role?: string; isSupportSession?: boolean },
  ): Observable<{ data: SessionEventPayload }> {
    // 25-second keep-alive heartbeat. Heartbeats are not account events.
    const keepAlive$ = interval(25000).pipe(
      map(() => ({
        data: {
          type: "PING" as const,
          timestamp: new Date().toISOString(),
        },
      })),
    );

    const filteredEvents$ = this.events$.asObservable().pipe(
      filter((evt) => {
        const matchesTenant = Boolean(
          evt.tenantId && tenantId && evt.tenantId === tenantId,
        );
        const matchesOrg = Boolean(
          evt.organizationId &&
            organizationId &&
            evt.organizationId === organizationId,
        );
        // No match means this connection belongs to a different account.
        // An empty subscriber id must not receive every tenant's event.
        if (!matchesTenant && !matchesOrg) return false;

        // The platform admin who performed the action stays signed in.
        // A support session inside the suspended company is still that company's session.
        if (
          subscriber?.role === "SUPER_ADMIN" &&
          !subscriber.isSupportSession
        ) {
          return false;
        }
        return true;
      }),
      map((evt) => ({ data: evt })),
    );

    return merge(keepAlive$, filteredEvents$);
  }
}
