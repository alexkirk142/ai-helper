import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { auditLog } from "../services/audit-log";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.requestId = requestId;

  // Expose request ID to the client for distributed tracing.
  res.setHeader("X-Request-Id", requestId);

  // Wrap the remainder of the request lifecycle in a fresh ALS context so that
  // every async operation downstream (route handlers, services, workers) gets an
  // isolated, per-request AuditContext without concurrent requests overwriting
  // each other's requestId / ipAddress / tenantId.
  auditLog.runWithContext(
    {
      requestId,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    },
    () => next()
  );
}
