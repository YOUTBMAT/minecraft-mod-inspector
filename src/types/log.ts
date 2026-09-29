export type LogLevel = "info" | "warn" | "error";

export interface InspectionLog {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}
