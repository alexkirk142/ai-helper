import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId || "unknown";
  
  // Log error with structured format
  console.error(JSON.stringify({
    level: "error",
    type: "error",
    requestId,
    message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  }));

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation error",
      details: err.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
      requestId,
    });
    return;
  }

  // Handle known operational errors
  if (err.isOperational) {
    res.status(err.statusCode || 400).json({
      error: err.message,
      requestId,
    });
    return;
  }

  // Handle unknown errors
  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 
    ? "Internal server error" 
    : err.message;

  res.status(statusCode).json({
    error: message,
    requestId,
  });
}

// Custom error class for operational errors
export class OperationalError extends Error {
  statusCode: number;
  isOperational = true;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = "OperationalError";
  }
}

// Not found handler
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    requestId: req.requestId,
  });
}
