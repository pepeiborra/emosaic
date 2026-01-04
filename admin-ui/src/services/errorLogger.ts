/**
 * Error logging service for client-side error tracking.
 * Logs errors to console with structured data and sends to backend for persistence.
 */

import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE = import.meta.env.DEV ? '/api' : import.meta.env.VITE_API_URL;

/** Error severity levels */
export type ErrorSeverity = 'error' | 'warning' | 'info';

/** Error categories for grouping and filtering */
export type ErrorCategory =
  | 'mosaic_creation'
  | 'image_upload'
  | 'api_request'
  | 'authentication'
  | 'file_processing'
  | 'unknown';

/** Structured error log entry */
export interface ErrorLogEntry {
  /** Error category for grouping */
  category: ErrorCategory;
  /** Error severity level */
  severity: ErrorSeverity;
  /** Human-readable error message */
  message: string;
  /** Original error message if available */
  originalError?: string;
  /** Stack trace if available */
  stack?: string;
  /** Step in the process where error occurred */
  step?: string;
  /** Additional context data */
  context?: Record<string, unknown>;
  /** Client timestamp */
  timestamp: string;
  /** User agent string */
  userAgent: string;
  /** Current URL */
  url: string;
}

/** Get current user email if authenticated */
async function getCurrentUserEmail(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.idToken?.payload;
    return (payload?.email as string) || null;
  } catch {
    return null;
  }
}

/** Create a structured error log entry */
function createLogEntry(
  category: ErrorCategory,
  severity: ErrorSeverity,
  message: string,
  error?: Error | unknown,
  step?: string,
  context?: Record<string, unknown>
): ErrorLogEntry {
  const entry: ErrorLogEntry = {
    category,
    severity,
    message,
    step,
    context,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: window.location.href,
  };

  if (error instanceof Error) {
    entry.originalError = error.message;
    entry.stack = error.stack;
  } else if (error !== undefined) {
    entry.originalError = String(error);
  }

  return entry;
}

/** Log error to console with structured format */
function logToConsole(entry: ErrorLogEntry): void {
  const prefix = `[${entry.severity.toUpperCase()}] [${entry.category}]`;
  const stepInfo = entry.step ? ` (step: ${entry.step})` : '';

  console.error(`${prefix}${stepInfo}: ${entry.message}`, {
    timestamp: entry.timestamp,
    context: entry.context,
    originalError: entry.originalError,
    stack: entry.stack,
  });
}

/** Send error log to backend API */
async function sendToBackend(entry: ErrorLogEntry, userEmail: string | null): Promise<void> {
  try {
    // Get auth token - required for error logging endpoint
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    if (!token) {
      // Can't log without auth - just skip backend logging
      console.warn('[ErrorLogger] Cannot send error to backend: no auth token');
      return;
    }

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': token,
    };

    const payload = {
      ...entry,
      user_email: userEmail,
    };

    // Fire and forget - don't wait for response or handle errors
    // We don't want error logging to cause additional errors
    fetch(`${API_BASE}/errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silently ignore errors when logging errors
    });
  } catch {
    // Silently ignore errors when logging errors
  }
}

/**
 * Log an error with full context.
 * Logs to console and sends to backend for persistence.
 */
export async function logError(
  category: ErrorCategory,
  message: string,
  error?: Error | unknown,
  step?: string,
  context?: Record<string, unknown>
): Promise<void> {
  const entry = createLogEntry(category, 'error', message, error, step, context);
  logToConsole(entry);

  const userEmail = await getCurrentUserEmail();
  await sendToBackend(entry, userEmail);
}

/**
 * Log a warning with context.
 */
export async function logWarning(
  category: ErrorCategory,
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  const entry = createLogEntry(category, 'warning', message, undefined, undefined, context);
  logToConsole(entry);

  const userEmail = await getCurrentUserEmail();
  await sendToBackend(entry, userEmail);
}

/**
 * Create a mosaic creation error logger with pre-configured context.
 * Returns logging functions that automatically include mosaic creation context.
 */
export function createMosaicCreationLogger(baseContext?: Record<string, unknown>) {
  return {
    /**
     * Log a mosaic creation error at a specific step.
     */
    logStepError: async (
      step: string,
      message: string,
      error?: Error | unknown,
      additionalContext?: Record<string, unknown>
    ): Promise<void> => {
      await logError(
        'mosaic_creation',
        message,
        error,
        step,
        { ...baseContext, ...additionalContext }
      );
    },

    /**
     * Log a mosaic creation warning.
     */
    logWarning: async (
      message: string,
      additionalContext?: Record<string, unknown>
    ): Promise<void> => {
      await logWarning(
        'mosaic_creation',
        message,
        { ...baseContext, ...additionalContext }
      );
    },
  };
}
