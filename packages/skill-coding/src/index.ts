import type { HarnessEvent, LocalHarness, RunInput } from '@robbot/core';

export interface CodingSkillContext {
  harness: LocalHarness;
  sessionId: string;
}

export class CodingSkill {
  readonly id = 'coding';
  readonly name = 'Coding';

  execute(context: CodingSkillContext, input: RunInput): AsyncIterable<HarnessEvent> {
    return context.harness.run(context.sessionId, input);
  }
}
