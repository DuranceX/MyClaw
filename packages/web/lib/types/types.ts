export type ToolLikePart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
};

export type ProgressStage = 'user' | 'assistant' | 'tool_call' | 'tool_result';

export type ProgressStageItem = {
  stage: ProgressStage;
  detail: unknown;
};
