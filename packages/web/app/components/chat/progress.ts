import type { ProgressStageItem } from '../../../lib/types/types';

function getText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join('');
}

export function getCurrentSessionMessages<T extends { role: string }>(messages: T[]): T[] {
  const lastUserIndex = [...messages].map(message => message.role).lastIndexOf('user');
  return lastUserIndex >= 0 ? messages.slice(lastUserIndex) : messages;
}

export function getProgressStages(messages: Array<{ role: string; parts: Array<{ type: string; text?: string; state?: string; input?: unknown; output?: unknown; toolCallId?: string; errorText?: string }> }>): ProgressStageItem[] {
  const stages: ProgressStageItem[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      const text = getText(message.parts);
      if (text.trim()) {
        stages.push({
          stage: 'user',
          detail: {
            role: 'user',
            parts: [{ type: 'text', text }],
          },
        });
      }
      continue;
    }

    if (message.role !== 'assistant') {
      continue;
    }

    const steps = message.parts.reduce<Array<Array<{ type: string; text?: string; state?: string; input?: unknown; output?: unknown; toolCallId?: string; errorText?: string }>>>((acc, part) => {
      if (part.type === 'step-start') {
        acc.push([]);
      } else if (acc.length > 0) {
        acc[acc.length - 1].push(part);
      }
      return acc;
    }, []);

    for (const step of steps) {
      const text = getText(step);
      const toolParts = step.filter(part => part.type.startsWith('tool-'));

      if (text) {
        stages.push({
          stage: 'assistant',
          detail: {
            role: 'assistant',
            parts: [{ type: 'text', text }],
          },
        });
      }

      for (const toolPart of toolParts) {
        stages.push({
          stage: 'tool_call',
          detail: {
            type: 'tool-call',
            toolCallId: toolPart.toolCallId,
            toolName: toolPart.type.slice(5),
            state: toolPart.state,
            input: toolPart.input ?? {},
          },
        });

        if (toolPart.state === 'output-available' || toolPart.state === 'output-error') {
          stages.push({
            stage: 'tool_result',
            detail: {
              type: 'tool-result',
              toolCallId: toolPart.toolCallId,
              toolName: toolPart.type.slice(5),
              state: toolPart.state,
              output: toolPart.output,
              errorText: toolPart.errorText,
            },
          });
        }
      }
    }
  }

  return stages;
}
