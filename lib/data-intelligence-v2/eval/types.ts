import type {
  V2AssistantResponse,
  V2AssistantResponseType,
} from "@/lib/data-intelligence-v2/assistant-response";
import type { DataIntelligenceV2Config } from "@/lib/data-intelligence-v2/config";
import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { V2ModelAdapter } from "@/lib/data-intelligence-v2/model-adapter";
import type { RevealTokenService } from "@/lib/data-intelligence-v2/reveal-token-service";
import type { SensitiveValueProvider } from "@/lib/data-intelligence-v2/sensitive-value-provider";
import type {
  SafeConversationState,
  V2ToolName,
  V2ToolResult,
} from "@/lib/data-intelligence-v2/types";

export type V2EvalAdapterMode = "mock" | "openai_fake_data";

export type V2EvalCaseCategory =
  | "client_resolution"
  | "account_data"
  | "statement"
  | "tax_document"
  | "identity_status"
  | "sensitive_reveal"
  | "workflow_task"
  | "missing_data"
  | "ambiguity"
  | "followup"
  | "red_team";

export type V2EvalExpectedToolCall = {
  toolName: V2ToolName;
  required?: boolean;
};

export type V2EvalForbiddenToolCall = {
  toolName: V2ToolName | string;
  reason: string;
};

export type V2EvalTurn = {
  userMessage: string;
  expectedResponseType?: V2AssistantResponseType;
  expectedToolCalls?: V2EvalExpectedToolCall[];
  forbiddenToolCalls?: V2EvalForbiddenToolCall[];
  requiredAnswerSubstrings?: string[];
  forbiddenAnswerSubstrings?: string[];
  requireSecureRevealCard?: boolean;
  requireMissingData?: boolean;
  requireDraftNote?: boolean;
  requireRecommendedSteps?: boolean;
  notes?: string;
};

export type V2EvalCase = {
  id: string;
  title: string;
  category: V2EvalCaseCategory;
  description: string;
  turns: V2EvalTurn[];
};

export type V2EvalGrade = {
  passed: boolean;
  score: number;
  reasons: string[];
  safetyFailures: string[];
  toolFailures: string[];
  qualityFailures: string[];
};

export type V2EvalTurnResult = {
  caseId: string;
  turnIndex: number;
  userMessage: string;
  response: V2AssistantResponse;
  nextConversationState: SafeConversationState;
  toolResults: V2ToolResult[];
  grade: V2EvalGrade;
};

export type V2EvalCaseResult = {
  caseId: string;
  title: string;
  category: V2EvalCaseCategory;
  passed: boolean;
  score: number;
  turnResults: V2EvalTurnResult[];
};

export type V2EvalRunSummary = {
  mode: V2EvalAdapterMode;
  passed: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  averageScore: number;
  safetyFailures: number;
  toolFailures: number;
  qualityFailures: number;
  caseResults: V2EvalCaseResult[];
};

export type RunV2EvalSuiteArgs = {
  mode?: V2EvalAdapterMode;
  cases?: V2EvalCase[];
  config?: DataIntelligenceV2Config;
  modelAdapter?: V2ModelAdapter;
  dataGateway?: ClientDataGateway;
  sensitiveValueProvider?: SensitiveValueProvider;
  revealTokenService?: RevealTokenService;
  print?: boolean;
};
