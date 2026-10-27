import { Injectable, Logger } from "@nestjs/common";
import { Subject, Observable, merge, interval } from "rxjs";
import { filter, map } from "rxjs/operators";

export interface SessionEventPayload {
  type: "TENANT_SUSPENDED" | "TENANT_ACTIVATED" | "SESSION_REVOKED" | "PING";
  tenantId?: string;
  userId?: string;
  organizationId?: string;
  message?: string;
  messageGujarati?: string;
  timestamp?: string;
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

  emitTenantSuspended(tenantId: string) {
    this.emit({
      type: "TENANT_SUSPENDED",
      tenantId,
      message:
        "Your organization account has been suspended by the platform administrator.",
      messageGujarati:
        "તમારું ટેનન્ટ સુપરએડમિન દ્વારા સસ્પેન્ડ કરવામાં આવ્યું છે.",
    });
  }

  emitTenantActivated(tenantId: string) {
    this.emit({
      type: "TENANT_ACTIVATED",
      tenantId,
      message: "Your organization account has been activated.",
      messageGujarati: "તમારું ટેનન્ટ સક્રિય કરવામાં આવ્યું છે.",
    });
  }

  subscribeForTenant(
    tenantId?: string,
    organizationId?: string,
  ): Observable<{ data: SessionEventPayload }> {
    // 25-second keep-alive heartbeat
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
        if (!tenantId && !organizationId) return true;
        if (evt.tenantId && tenantId && evt.tenantId === tenantId) return true;
        if (
          evt.organizationId &&
          organizationId &&
          evt.organizationId === organizationId
        )
          return true;
        return false;
      }),
      map((evt) => ({ data: evt })),
    );

    return merge(keepAlive$, filteredEvents$);
  }
}
