import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { CORRELATION_ID_HEADER } from "../interceptors/correlation-id.interceptor";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const correlationId =
      request?.correlationId ||
      request?.headers?.[CORRELATION_ID_HEADER] ||
      request?.headers?.["x-request-id"] ||
      "unknown";

    const isHttpException = exception instanceof HttpException;
    const isFastifyFileTooLarge =
      (exception as any)?.code === "FST_REQ_FILE_TOO_LARGE" ||
      (exception as any)?.statusCode === 413 ||
      (exception instanceof Error && exception.message.includes("request file too large"));

    const status = isHttpException
      ? exception.getStatus()
      : isFastifyFileTooLarge
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : typeof (exception as any)?.statusCode === "number" && (exception as any).statusCode >= 400 && (exception as any).statusCode < 600
          ? (exception as any).statusCode
          : HttpStatus.INTERNAL_SERVER_ERROR;

    const isProduction = process.env.NODE_ENV === "production";

    let responsePayload: any;

    if (isHttpException) {
      const res = exception.getResponse();
      if (typeof res === "object" && res !== null) {
        responsePayload = {
          ...res,
          correlationId,
          timestamp: new Date().toISOString(),
        };
      } else {
        responsePayload = {
          statusCode: status,
          message: res,
          correlationId,
          timestamp: new Date().toISOString(),
        };
      }
    } else {
      // Unhandled Server Exception (500)
      this.logger.error(
        JSON.stringify({
          type: "UNHANDLED_EXCEPTION",
          correlationId,
          method: request?.method,
          url: request?.url,
          error:
            exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      );

      // In production mode, conceal internal database errors, schema details, or stack traces
      responsePayload = isFastifyFileTooLarge
        ? {
            statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
            error: "Payload Too Large",
            message: "File size exceeds the 15 MB limit. Please upload a smaller document or optimize your invoice photo.",
            correlationId,
            timestamp: new Date().toISOString(),
          }
        : {
            statusCode: status,
            error: status >= 500 ? "Internal Server Error" : "Bad Request",
            message: isProduction && status >= 500
              ? "An unexpected internal server error occurred. Please quote the correlation ID to support."
              : exception instanceof Error
                ? exception.message
                : "An unexpected error occurred.",
            correlationId,
            timestamp: new Date().toISOString(),
          };
    }

    if (response && typeof response.status === "function") {
      if (typeof response.send === "function") {
        response.status(status).send(responsePayload);
      } else if (typeof response.json === "function") {
        response.status(status).json(responsePayload);
      }
    }
  }
}
