import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import * as crypto from "crypto";

export const CORRELATION_ID_HEADER = "x-correlation-id";

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();

    const correlationId =
      (request.headers[CORRELATION_ID_HEADER] as string) ||
      (request.headers["x-request-id"] as string) ||
      crypto.randomUUID();

    request.correlationId = correlationId;

    const setHeader = (name: string, value: string) => {
      if (response && typeof response.header === "function") {
        response.header(name, value);
      } else if (response && typeof response.setHeader === "function") {
        response.setHeader(name, value);
      }
    };

    setHeader(CORRELATION_ID_HEADER, correlationId);
    setHeader("X-Content-Type-Options", "nosniff");
    setHeader("X-Frame-Options", "SAMEORIGIN");
    setHeader("X-XSS-Protection", "1; mode=block");
    setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    const startTime = Date.now();
    const { method, url } = request;

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode || 200;
          this.logger.log(
            JSON.stringify({
              type: "ACCESS_LOG",
              correlationId,
              method,
              url,
              statusCode,
              durationMs: duration,
              tenantOrg: request.user?.organizationId || "anonymous",
              userId: request.user?.userId || request.user?.id || "anonymous",
            }),
          );
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          const statusCode = err?.status || err?.statusCode || 500;
          this.logger.warn(
            JSON.stringify({
              type: "ACCESS_ERROR",
              correlationId,
              method,
              url,
              statusCode,
              durationMs: duration,
              error: err?.message || String(err),
            }),
          );
        },
      }),
    );
  }
}
