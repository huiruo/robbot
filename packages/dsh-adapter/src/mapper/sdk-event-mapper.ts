import type { HarnessEvent } from '@robbot/core';

export interface SdkMappedEvent {
  event: HarnessEvent;
  sawTurnStart?: boolean;
  sawTurnEnd?: boolean;
}

export function mapSdkNotificationToHarnessEvents(method: string, params: unknown): SdkMappedEvent[] {
  if (method === 'session.event') {
    return mapSessionEvent(params);
  }

  return [];
}

function mapSessionEvent(params: unknown): SdkMappedEvent[] {
  const event = asRecord(asRecord(params)?.event);
  if (!event || typeof event.type !== 'string') {
    return [];
  }

  if (event.type === 'turn/start') {
    return [{ event: { type: 'tool.output', toolCallId: 'turn', output: '' }, sawTurnStart: true }];
  }

  if (event.type === 'turn/end') {
    return [{ event: { type: 'tool.output', toolCallId: 'turn', output: '' }, sawTurnEnd: true }];
  }

  if (event.type === 'assistant/chunk') {
    const chunk = asRecord(asRecord(event.data)?.chunk);
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
      return [{ event: { type: 'assistant.delta', text: chunk.text } }];
    }
    return [];
  }

  if (event.type === 'assistant/message') {
    const text = contentText(asRecord(asRecord(event.data)?.message)?.content);
    if (text) {
      return [{ event: { type: 'assistant.message', text } }];
    }
    return [];
  }

  if (event.type === 'tool/call') {
    const data = asRecord(event.data);
    const callId = stringField(data, 'callId');
    const name = stringField(data, 'name');
    if (!callId || !name) {
      return [];
    }

    return [{
      event: {
        type: 'tool.started',
        toolCallId: callId,
        name,
        input: parseToolArguments(data?.arguments),
      },
    }];
  }

  if (event.type === 'tool/result') {
    const message = asRecord(asRecord(event.data)?.message);
    const callId = stringField(asRecord(message?.source), 'callId');
    if (!callId) {
      return [];
    }

    const text = contentText(message?.content);
    return [
      ...(text ? [{ event: { type: 'tool.output' as const, toolCallId: callId, output: text } }] : []),
      { event: { type: 'tool.completed', toolCallId: callId, result: event.data } },
    ];
  }

  return [];
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block): block is { type: string; text: string } =>
      Boolean(block) && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('');
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
