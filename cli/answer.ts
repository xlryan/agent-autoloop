// The command line and the local dashboard both answer a card through this call.
import type { Hub } from "../protocol/client.ts";

export type AnswerInput = { choice?: number; text?: string };

/** What `answer` sends after the command line has turned a 1-based option into the protocol's index. */
export function answerPayload(input: AnswerInput) {
  const text = input.text?.trim();
  return {
    ...(input.choice !== undefined && { choice: input.choice }),
    ...(text && { text }),
  };
}

export function answerCard(owner: Pick<Hub, "answer">, card: number, input: AnswerInput) {
  return owner.answer(card, answerPayload(input));
}

/** The sentence the command prints, so the page says the same thing. */
export function answerWords(done: { changed: boolean; state: string }) {
  return !done.changed
    ? "这张卡片已经处理过了，这次没有改动。"
    : done.state === "closed"
      ? "结案了。"
      : "收到，Agent 接着干。";
}
