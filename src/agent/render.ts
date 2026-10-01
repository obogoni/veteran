import type { VeteranAnswer } from "./answerSchema.ts";

/** Headings per supported profile language; `assertAskable` rejects any other language before a run. */
const HEADINGS: Record<string, { clarifying: string; branches: string; tests: string; dependsOn: string; caveats: string }> = {
  "pt-BR": {
    clarifying: "Pergunta para você:",
    branches: "Depende do caso:",
    tests: "Cenários para testar:",
    dependsOn: "Depende de:",
    caveats: "Observações:",
  },
};

/** The answer as support reads it. `internalReferences` is never rendered. */
export function renderAnswer(answer: VeteranAnswer, versionCaveat: string, language: string): string {
  const headings = HEADINGS[language];
  if (!headings) throw new Error(`no headings for language ${language}`);
  const blocks: string[] = [];
  const list = (heading: string, items: string[]) => {
    if (items.length > 0) blocks.push([heading, ...items.map((item) => `- ${item}`)].join("\n"));
  };

  if (answer.clarifyingQuestion !== null && answer.clarifyingQuestion.trim() !== "") {
    blocks.push(`${headings.clarifying}\n${answer.clarifyingQuestion}`);
  }
  blocks.push(answer.answer);
  list(headings.branches, answer.branches.map((branch) => `${branch.condition}: ${branch.behavior}`));
  list(headings.tests, answer.suggestedTests);
  list(headings.dependsOn, answer.dependsOn);
  list(headings.caveats, answer.caveats);
  blocks.push(versionCaveat);
  return `${blocks.join("\n\n")}\n`;
}

/** The fallback copy per supported profile language. */
const FALLBACK: Record<string, { message: string; forward: string; question: string; record: string }> = {
  "pt-BR": {
    message: "Não consegui responder isso com segurança. Leve a pergunta para um desenvolvedor.",
    forward: "Texto para encaminhar:",
    question: "Pergunta:",
    record: "Registro:",
  },
};

/** What the reader sees instead of an answer that failed validation: no answer text and no version caveat. */
export function renderFallback(question: string, transcriptName: string, language: string): string {
  const copy = FALLBACK[language];
  if (!copy) throw new Error(`no fallback copy for language ${language}`);
  return `${copy.message}\n\n${copy.forward}\n${copy.question} ${question}\n${copy.record} ${transcriptName}\n`;
}
