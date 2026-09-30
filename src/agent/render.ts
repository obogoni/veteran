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
