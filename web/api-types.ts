import type { TokenUsage } from "../shared/token-usage";

export type AgentId =
  | "factory-manager"
  | "developer"
  | "qa-reviewer"
  | "delivery-manager"
  | "disenador"
  | "auditoria-seguridad";

export type Job = {
  id: string;
  name: string;
  request: string;
  requestKind?: "project" | "question";
  action?: "new" | "modify" | "question";
  scope?: "quick" | "full";
  checkpoint?: string;
  answer?: string;
  tokens?: TokenUsage;
  status: string;
  phase: string;
  createdAt: string;
  updatedAt: string;
  directory: string;
  logs: string[];
  lastError?: string;
};

export type ProjectItem = { name: string; path: string; hasPackage: boolean; hasIndex: boolean };

export type Settings = {
  mode: "common" | "independent";
  commonModel: string;
  agentModels: Record<AgentId, string>;
  autoApprove: boolean;
  modelStatus?: Record<string, string>;
  agentModelConfigVersion?: 2;
};
